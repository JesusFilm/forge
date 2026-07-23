/**
 * Bearer-gated read surface for the ai-chat lane's persisted conversations
 * (feat-241): the listing handler behind `POST /forge-ai-chat-history-list`
 * and the replay handler behind `POST /forge-ai-chat-history-replay`, both
 * registered in `./index.ts` with per-route in-handler validation (never
 * `/api/*` middleware — that breaks Studio; see
 * docs/solutions/integration-issues/mastra-studio-api-auth-guard.md).
 *
 * Gate ladder, checked in order (KTD2): the shared lane admission preamble
 * (`refuseUnlessLaneAdmitted`, feat-283 — enable flag → 404, then the
 * dedicated `AI_CHAT_SERVICE_API_KEYS` lane bearer → 401, key sourcing inside
 * that module) → body validation → `user:`-resource refusal (R2: the
 * anonymous and dogfood fallback resources are never listable or replayable)
 * → store reads, all bounded by `TIME_BUDGET_MS.historyRead`
 * (millisecond-class queries must not inherit the 90s turn envelope).
 *
 * Replay (KTD4/KTD5): `resolveOwnedExistingThread` (feat-284) answers
 * ownership + existence from ONE `getThreadById` — missing thread →
 * `thread_not_found`, owner mismatch → `thread_forbidden`, no ceiling branch
 * on reads (`listThreads` is never called) — then a capped `recall` that
 * ALWAYS passes `resourceId` (omitting it disables the store's own ownership
 * throw) and an explicit `perPage` (the dist default returns only the last
 * 10). Messages are projected field-by-field — user/assistant text only,
 * per-message char cap — so tool-call internals, retrieval payloads, and
 * provider metadata never reach the wire.
 *
 * Logging is ENUM-only plain-string `[ai-chat-history] event=… reason=…`
 * (KTD13) — never thread ids, titles, transcript text, or exception text.
 */

import { refuseUnlessLaneAdmitted } from "./ai-chat-lane-admission"
import { settleWithinBudget, TIME_BUDGET_MS } from "./budgets"
import {
  resolveOwnedExistingThread,
  USER_RESOURCE_PREFIX,
} from "./ai-chat-thread-ownership"
import { getAiChatMemory } from "./ai-chat-memory"

/** Default + ceiling for the listing page size (KTD6; the store has no cap of
 * its own). The chat side deliberately holds no copy of these — it consumes
 * the returned envelope. */
export const AI_CHAT_HISTORY_DEFAULT_PER_PAGE = 20
export const AI_CHAT_HISTORY_MAX_PER_PAGE = 50

/** Replay reads the last N messages of a thread (Scope: no message-level
 * pagination day one). Explicit because the dist's recall default is 10. */
export const AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT = 200

/** Per-message cap on projected text (KTD5) so the transcript payload is
 * bounded by construction. The unit is UTF-16 code units (String.slice), ≤3
 * UTF-8 bytes each — worst case ~200 × 24 kB ≈ 4.8 MB, which the chat
 * proxy's 8 MiB thread cap clears. Accepted fidelity loss: truncation. */
export const AI_CHAT_HISTORY_TEXT_CAP_CHARS = 8_192

/** Mirrors the chat proxy's MAX_CONVERSATION_ID_CHARS bound. */
const MAX_THREAD_ID_CHARS = 200

/**
 * The narrow Memory surface the history handlers need (KTD3) — structural so
 * tests fake it; the real instance from `getAiChatMemory()` satisfies it. The
 * same instance feeds `resolveOwnedExistingThread`, so ownership resolution
 * and the read path cannot diverge.
 */
export type AiChatHistoryMemory = {
  listThreads: (args: {
    filter?: { resourceId?: string }
    page?: number
    perPage?: number
    orderBy?: { field?: "createdAt" | "updatedAt"; direction?: "ASC" | "DESC" }
  }) => Promise<{
    threads: Array<{
      id: string
      title?: string | null
      updatedAt?: Date | string | null
    }>
    total: number
    page: number
    perPage: number | false
    hasMore: boolean
  }>
  getThreadById: (args: {
    threadId: string
  }) => Promise<{ resourceId?: string | null } | null>
  recall: (args: {
    threadId: string
    resourceId: string
    perPage: number
  }) => Promise<{ messages: unknown[] }>
}

/** Buffered-JSON route outcome (`{ status, body }` adapter — the repo's
 * standard non-streaming route shape; index.ts wraps it in a Response). */
export type AiChatHistoryRouteOutcome = { status: number; body: unknown }

/** One listed thread as projected onto the wire. `title` may be `""` — the
 * untitled sentinel the client turns into a date-derived fallback label. */
export type AiChatHistoryWireThread = {
  id: string
  title: string
  updatedAt: string
}

/** One replayed turn as projected onto the wire (KTD5): plain text only. */
export type AiChatHistoryWireMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: string
}

/**
 * Shared handler input. Seams mirror the send route's: `getEnabled` (flag) and
 * `getServiceKeys` (lane CSV) forward to the admission module's defaults
 * (feat-283 — key sourcing lives there, so a registration cannot accidentally
 * wire the shared pool), plus `getMemory` and `budgetMs` (deterministically
 * testable timeout branch).
 */
export type AiChatHistoryHandlerInput = {
  authHeader: string | null | undefined
  readJson: () => Promise<unknown>
  getEnabled?: () => boolean
  getServiceKeys?: () => readonly string[]
  getMemory?: () => AiChatHistoryMemory
  budgetMs?: number
}

function jsonOutcome(status: number, body: unknown): AiChatHistoryRouteOutcome {
  return { status, body }
}

/** ISO-serialize a store timestamp; unparseable/absent degrades to "". */
function toIsoString(value: Date | string | null | undefined): string {
  if (value == null) return ""
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString()
}

type AiChatHistoryListBody = {
  resourceId: string
  page: number
  perPage: number
}

/**
 * Listing body guard: `resourceId` must be a string (an EMPTY string passes
 * here and is refused by the resource gate — 403, not 400); `page` an integer
 * ≥ 0; `perPage` a positive number, clamped to the ceiling.
 */
function parseListBody(value: unknown): AiChatHistoryListBody | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as { resourceId?: unknown; page?: unknown; perPage?: unknown }
  if (typeof v.resourceId !== "string") return null
  if (
    v.page !== undefined &&
    (typeof v.page !== "number" || !Number.isInteger(v.page) || v.page < 0)
  ) {
    return null
  }
  if (
    v.perPage !== undefined &&
    (typeof v.perPage !== "number" ||
      !Number.isFinite(v.perPage) ||
      v.perPage <= 0)
  ) {
    return null
  }
  const page = v.page === undefined ? 0 : v.page
  const perPage =
    v.perPage === undefined
      ? AI_CHAT_HISTORY_DEFAULT_PER_PAGE
      : Math.min(
          AI_CHAT_HISTORY_MAX_PER_PAGE,
          Math.max(1, Math.floor(v.perPage)),
        )
  return { resourceId: v.resourceId, page, perPage }
}

function parseReplayBody(
  value: unknown,
): { resourceId: string; threadId: string } | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as { resourceId?: unknown; threadId?: unknown }
  if (typeof v.resourceId !== "string") return null
  if (
    typeof v.threadId !== "string" ||
    v.threadId.length === 0 ||
    v.threadId.length > MAX_THREAD_ID_CHARS
  ) {
    return null
  }
  return { resourceId: v.resourceId, threadId: v.threadId }
}

/**
 * Project one listed thread onto the wire field-by-field — never spreads, so a
 * future store field cannot silently widen the wire. A stored `""` title
 * passes through verbatim (the client's untitled sentinel).
 */
function projectThreadRow(row: {
  id: string
  title?: string | null
  updatedAt?: Date | string | null
}): AiChatHistoryWireThread {
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    updatedAt: toIsoString(row.updatedAt),
  }
}

/**
 * Project one stored message onto the wire (KTD5). Total: any shape mismatch
 * drops the message rather than throwing. Only `user`/`assistant` roles pass
 * (`system`/`signal` dropped); text is joined from `parts` of type `"text"`
 * only — tool-invocation parts, retrieval payloads, and provider metadata are
 * unrepresentable in the output shape — and capped per message.
 */
function projectStoredMessage(
  candidate: unknown,
): AiChatHistoryWireMessage | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const m = candidate as {
    id?: unknown
    role?: unknown
    createdAt?: unknown
    content?: unknown
  }
  if (typeof m.id !== "string" || m.id.length === 0) return null
  if (m.role !== "user" && m.role !== "assistant") return null
  const content = m.content as { parts?: unknown } | null | undefined
  const texts: string[] = []
  if (content && Array.isArray(content.parts)) {
    for (const part of content.parts) {
      if (typeof part !== "object" || part === null) continue
      const p = part as { type?: unknown; text?: unknown }
      if (
        p.type === "text" &&
        typeof p.text === "string" &&
        p.text.length > 0
      ) {
        texts.push(p.text)
      }
    }
  }
  const joined = texts.join("\n\n")
  return {
    id: m.id,
    role: m.role,
    text:
      joined.length > AI_CHAT_HISTORY_TEXT_CAP_CHARS
        ? joined.slice(0, AI_CHAT_HISTORY_TEXT_CAP_CHARS)
        : joined,
    createdAt: toIsoString(m.createdAt as Date | string | null | undefined),
  }
}

/**
 * `POST /forge-ai-chat-history-list` core (R1/R2/R4/R11): paginated listing of
 * the caller's own `user:*` threads, most-recently-active first. Returns the
 * `{ status, body }` outcome; success body is
 * `{ threads: [{ id, title, updatedAt }], page, perPage, total, hasMore }`.
 */
export async function handleAiChatHistoryListRequest({
  authHeader,
  readJson,
  getEnabled,
  getServiceKeys,
  getMemory = () => getAiChatMemory(),
  budgetMs = TIME_BUDGET_MS.historyRead,
}: AiChatHistoryHandlerInput): Promise<AiChatHistoryRouteOutcome> {
  const refusal = refuseUnlessLaneAdmitted({
    authHeader,
    getEnabled,
    getServiceKeys,
  })
  if (refusal) return refusal

  const raw = await readJson().catch(() => undefined)
  const body = parseListBody(raw)
  if (!body) return jsonOutcome(400, { reason: "invalid_body" })

  // R2: only signed-in resources are listable — the shared dogfood fallback,
  // anon:* ids, and anything else un-prefixed are refused before any store I/O.
  if (!body.resourceId.startsWith(USER_RESOURCE_PREFIX)) {
    console.warn(
      "[ai-chat-history] event=resource_rejected surface=list reason=resource_forbidden",
    )
    return jsonOutcome(403, { reason: "resource_forbidden" })
  }

  const budgetSignal = AbortSignal.timeout(budgetMs)
  try {
    const result = await settleWithinBudget(
      getMemory().listThreads({
        filter: { resourceId: body.resourceId },
        // Explicit: the dist default is createdAt DESC; the sidebar contract
        // is most-recently-ACTIVE first (saveMessages bumps updatedAt).
        orderBy: { field: "updatedAt", direction: "DESC" },
        page: body.page,
        perPage: body.perPage,
      }),
      budgetSignal,
    )
    return jsonOutcome(200, {
      threads: result.threads.map(projectThreadRow),
      page: result.page,
      perPage: result.perPage,
      total: result.total,
      hasMore: result.hasMore,
    })
  } catch {
    // Fixed-vocabulary reason only — no exception text on the wire or in logs.
    const reason = budgetSignal.aborted ? "timeout" : "store_failed"
    console.warn(`[ai-chat-history] event=list_failed reason=${reason}`)
    return jsonOutcome(reason === "timeout" ? 504 : 500, { reason })
  }
}

/**
 * `POST /forge-ai-chat-history-replay` core (R2/R3/R4/R21): the projected
 * transcript of ONE owned thread. Owned-existing-thread resolver → capped
 * recall (KTD4); success body is `{ messages: [...] }`. A vanished thread is
 * an explicit `thread_not_found`, never an empty-transcript success; a store
 * failure after admission is a generic failure, never `thread_not_found`
 * (fail closed).
 */
export async function handleAiChatHistoryReplayRequest({
  authHeader,
  readJson,
  getEnabled,
  getServiceKeys,
  getMemory = () => getAiChatMemory(),
  budgetMs = TIME_BUDGET_MS.historyRead,
}: AiChatHistoryHandlerInput): Promise<AiChatHistoryRouteOutcome> {
  const refusal = refuseUnlessLaneAdmitted({
    authHeader,
    getEnabled,
    getServiceKeys,
  })
  if (refusal) return refusal

  const raw = await readJson().catch(() => undefined)
  const body = parseReplayBody(raw)
  if (!body) return jsonOutcome(400, { reason: "invalid_body" })

  if (!body.resourceId.startsWith(USER_RESOURCE_PREFIX)) {
    console.warn(
      "[ai-chat-history] event=resource_rejected surface=replay reason=resource_forbidden",
    )
    return jsonOutcome(403, { reason: "resource_forbidden" })
  }

  const budgetSignal = AbortSignal.timeout(budgetMs)
  try {
    // Inside the try (matching the list handler): a sync memory-construction
    // throw must map to store_failed, never escape the closed outcome shape.
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
        `[ai-chat-history] event=thread_access_rejected reason=${resolution.reason}`,
      )
      return jsonOutcome(resolution.reason === "thread_forbidden" ? 403 : 404, {
        reason: resolution.reason,
      })
    }

    // `resourceId` is ALWAYS passed — omitting it disables the store's own
    // ownership throw (the belt-and-suspenders layer under the resolver above).
    const result = await settleWithinBudget(
      memory.recall({
        threadId: body.threadId,
        resourceId: body.resourceId,
        perPage: AI_CHAT_HISTORY_REPLAY_MESSAGE_LIMIT,
      }),
      budgetSignal,
    )
    const messages = result.messages
      .map(projectStoredMessage)
      .filter(
        (message): message is AiChatHistoryWireMessage => message !== null,
      )
    return jsonOutcome(200, { messages })
  } catch {
    // Fail CLOSED: a store outage (including the resolver's getThreadById
    // throw) is a generic failure — never thread_not_found, never exception
    // text.
    const reason = budgetSignal.aborted ? "timeout" : "store_failed"
    console.warn(`[ai-chat-history] event=replay_failed reason=${reason}`)
    return jsonOutcome(reason === "timeout" ? 504 : 500, { reason })
  }
}
