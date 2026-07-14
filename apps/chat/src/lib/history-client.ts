/**
 * Typed never-throw client for the two history proxy routes (feat-241, U5):
 * `fetchHistoryPage` → POST /api/history/list, `fetchHistoryThread` →
 * POST /api/history/thread. Single-service result-union convention (like
 * `streamReply`): every outcome is a discriminated `{ ok }` value, never a
 * throw. The closed failure set folds the KTD8 wire statuses into what the
 * hook needs: `access` (401 invalid_session / 403 gate_denied → silent
 * client-only fallback, R16), `not_available` (403 thread_forbidden /
 * 404 → the "no longer available" state, R18), `unavailable` (network/5xx/
 * parse → error state with retry).
 *
 * The client sends only `page` / `conversationId` — the page size's single
 * source is the Mastra route's clamp (KTD6); the consumed `hasMore` envelope
 * replaces any client-held constant. No resource field ever rides a request
 * body (R5 — the proxy resolves it from the session).
 */

/** One sidebar row from the server listing. `title` may be `""` — the
 * untitled sentinel the UI renders as a date-derived fallback label. */
export type HistoryThreadSummary = {
  id: string
  title: string
  updatedAt: string
}

/** One replayed turn: plain text only (R21 — no sources/engine metadata). */
export type HistoryMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  createdAt: string
}

/** The closed client-side failure vocabulary (see module JSDoc). */
export type HistoryFailureReason = "access" | "not_available" | "unavailable"

/** Listing outcome: one page of sidebar rows plus the server's `hasMore`
 * envelope (the page size lives server-side only), or a mapped failure. */
export type FetchHistoryPageResult =
  | { ok: true; threads: HistoryThreadSummary[]; hasMore: boolean }
  | { ok: false; reason: HistoryFailureReason }

/** Replay outcome: one thread's projected transcript, or a mapped failure. */
export type FetchHistoryThreadResult =
  | { ok: true; messages: HistoryMessage[] }
  | { ok: false; reason: HistoryFailureReason }

/**
 * Client-side ceiling on one history fetch — strictly above the proxy's 10s
 * upstream read budget, so when the server is reachable its clean
 * classification always wins; only a hung transport (stalled TCP, dead proxy)
 * hits this, landing in the retryable `unavailable` path instead of wedging
 * the loading state forever (sends stay blocked while loading, R22).
 */
export const HISTORY_FETCH_TIMEOUT_MS = 15_000

/**
 * Map a non-2xx proxy response onto the closed reason set. Body-conditional
 * for 403 AND 404 (KTD8 extended to the last hop): `not_available` requires
 * the proxy's own `thread_forbidden`/`thread_not_found` reason — a reasonless
 * 404 (deploy skew, route absent at the chat layer, CDN interception) is a
 * config-shaped outage and must stay retryable, never read as data loss.
 */
async function failureReasonFor(
  response: Response,
): Promise<HistoryFailureReason> {
  if (response.status === 401) return "access"
  if (response.status === 403 || response.status === 404) {
    const body = (await response.json().catch(() => undefined)) as
      | { reason?: unknown }
      | undefined
    if (body?.reason === "gate_denied") return "access"
    if (
      body?.reason === "thread_forbidden" ||
      body?.reason === "thread_not_found"
    ) {
      return "not_available"
    }
  }
  return "unavailable"
}

async function postJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response | null> {
  const budget = AbortSignal.timeout(timeoutMs)
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, budget]) : budget,
    })
  } catch {
    return null
  }
}

function projectThread(candidate: unknown): HistoryThreadSummary | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const t = candidate as { id?: unknown; title?: unknown; updatedAt?: unknown }
  if (typeof t.id !== "string" || t.id.length === 0) return null
  return {
    id: t.id,
    title: typeof t.title === "string" ? t.title : "",
    updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : "",
  }
}

function projectMessage(candidate: unknown): HistoryMessage | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const m = candidate as {
    id?: unknown
    role?: unknown
    text?: unknown
    createdAt?: unknown
  }
  if (typeof m.id !== "string" || m.id.length === 0) return null
  if (m.role !== "user" && m.role !== "assistant") return null
  const text = typeof m.text === "string" ? m.text : ""
  // A turn with no projected text (e.g. a tool-only assistant step) renders
  // as an empty bubble — drop it rather than show noise.
  if (text.trim().length === 0) return null
  return {
    id: m.id,
    role: m.role,
    text,
    createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
  }
}

/** Fetch one listing page (`{ page }` only — never a resource field). */
export async function fetchHistoryPage({
  page,
  fetchImpl = fetch,
  signal,
  timeoutMs = HISTORY_FETCH_TIMEOUT_MS,
}: {
  page: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<FetchHistoryPageResult> {
  const response = await postJson(
    "/api/history/list",
    { page },
    fetchImpl,
    signal,
    timeoutMs,
  )
  if (response === null) return { ok: false, reason: "unavailable" }
  if (!response.ok) {
    return { ok: false, reason: await failureReasonFor(response) }
  }
  const body = (await response.json().catch(() => undefined)) as
    | { threads?: unknown; hasMore?: unknown }
    | undefined
  if (body === undefined || !Array.isArray(body.threads)) {
    return { ok: false, reason: "unavailable" }
  }
  return {
    ok: true,
    threads: body.threads
      .map(projectThread)
      .filter((thread): thread is HistoryThreadSummary => thread !== null),
    hasMore: body.hasMore === true,
  }
}

/** Fetch one thread's transcript (`{ conversationId }` only). */
export async function fetchHistoryThread({
  conversationId,
  fetchImpl = fetch,
  signal,
  timeoutMs = HISTORY_FETCH_TIMEOUT_MS,
}: {
  conversationId: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<FetchHistoryThreadResult> {
  const response = await postJson(
    "/api/history/thread",
    { conversationId },
    fetchImpl,
    signal,
    timeoutMs,
  )
  if (response === null) return { ok: false, reason: "unavailable" }
  if (!response.ok) {
    return { ok: false, reason: await failureReasonFor(response) }
  }
  const body = (await response.json().catch(() => undefined)) as
    | { messages?: unknown }
    | undefined
  if (body === undefined || !Array.isArray(body.messages)) {
    return { ok: false, reason: "unavailable" }
  }
  return {
    ok: true,
    messages: body.messages
      .map(projectMessage)
      .filter((message): message is HistoryMessage => message !== null),
  }
}
