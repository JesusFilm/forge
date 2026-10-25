/**
 * Testable core for the chat history WRITE proxy (feat-450, KTD5):
 * `POST /api/history/rename` → Mastra `POST /forge-ai-chat-history-rename`.
 * Copies the read proxies' anatomy (`history-proxy.ts`) — session cookie →
 * `user:` resource (401 `invalid_session`), dogfood gate surface "history"
 * (403 `gate_denied`), config + the SSRF/host guard with `requireAllowlist`
 * threaded from the production egress pin, the shared transport, status
 * classified BEFORE any body parse, byte-capped JSON reads — extended for one
 * write: the body guard is `{ threadId, title }` only (a client-supplied
 * resource field is never read; the upstream `resourceId` comes from the
 * session alone), and the failure vocabulary gains `invalid_title`.
 *
 * Status ladder: 400 / 403 / 404 relay `invalid_title` / `thread_forbidden` /
 * `thread_not_found` ONLY when the upstream body carries that reason — a
 * reasonless 404 (the route not yet deployed, KTD1's deploy window; flag
 * off) and 503 `writes_disabled` are 502 `unavailable`, a retryable outage
 * and never a data claim; 504 is `timeout`; success relays `{ ok, title }`
 * projected field-by-field. The response cap is 4 KiB: the echoed title is
 * ≤120 UTF-16 units. Logging is enum-only `[history-proxy] event=… reason=…`
 * — never a thread id, a title, or a body fragment (R15).
 */

import {
  env,
  requireSeekerEgressAllowlist,
  seekerTimeoutMs,
} from "@/config/env"
import {
  classifyUpstreamFailure,
  composeUpstreamAbortSignal,
  MAX_CONVERSATION_ID_CHARS,
  postMastraUpstream,
  readJsonCapped,
  undefinedOnAbort,
  validateBaseUrl,
} from "@/lib/server/mastra-upstream"

import {
  composeHistoryTimeoutMs,
  type HistoryProxyConfig,
  type HistoryProxyFailureReason,
  type HistoryProxyHandlerInput,
} from "./history-proxy"

/** Byte cap on the buffered upstream JSON (OOM-guard law). The success body
 * is `{ ok, title }` with the title clamped server-side to 120 UTF-16 units
 * (≤3 UTF-8 bytes each) — a few hundred bytes; 4 KiB leaves envelope room
 * while bounding a misbehaving upstream far below the read caps. */
export const HISTORY_RENAME_MAX_RESPONSE_BYTES = 4 * 1024

/** Raw `title` bound in UTF-16 units, applied BEFORE Mastra's clamp (KTD2
 * mirrors it at the route). Over-bound is 400 `invalid_body`, not a clamp. */
export const MAX_RENAME_TITLE_RAW_UNITS = 1024

const RENAME_UPSTREAM_PATH = "/forge-ai-chat-history-rename"

/** The closed client-facing failure vocabulary for the write: the read
 * spellings verbatim plus `invalid_title` (the clamp emptied the title). */
export type HistoryWriteProxyFailureReason =
  | HistoryProxyFailureReason
  | "invalid_title"

/** Build the write proxy config from env (the route wrapper's default). Same
 * shape and sources as the read builder — including the [9 s, 10 s] read
 * window, which sits strictly above Mastra's 8 s route budget — kept as its
 * own builder so the egress-pin source is pinned at THIS call site
 * (`config/egress-pin-wiring.test.ts`). */
export function buildHistoryWriteProxyConfig(): HistoryProxyConfig {
  return {
    baseUrl: env.SEEKER_MASTRA_BASE_URL,
    apiKey: env.AI_CHAT_MASTRA_API_KEY,
    allowedHosts: env.SEEKER_MASTRA_ALLOWED_HOSTS,
    requireAllowlist: requireSeekerEgressAllowlist(),
    timeoutMs: composeHistoryTimeoutMs(seekerTimeoutMs()),
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function failureResponse(
  status: number,
  reason: HistoryWriteProxyFailureReason,
  event: string,
): Response {
  console.warn(`[history-proxy] event=${event} reason=${reason}`)
  return jsonResponse(status, { reason })
}

/** Body guard for `/api/history/rename`: a required, bounded thread id (the
 * read proxy's conversation-id bound) and a required raw title bounded at
 * 1,024 units. Projected field-by-field; any resource field is IGNORED. */
function parseRenameBody(
  value: unknown,
): { threadId: string; title: string } | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as { threadId?: unknown; title?: unknown }
  if (
    typeof v.threadId !== "string" ||
    v.threadId.length === 0 ||
    v.threadId.length > MAX_CONVERSATION_ID_CHARS
  ) {
    return null
  }
  if (
    typeof v.title !== "string" ||
    v.title.length > MAX_RENAME_TITLE_RAW_UNITS
  ) {
    return null
  }
  return { threadId: v.threadId, title: v.title }
}

/**
 * `POST /api/history/rename` core (R10, R11, R13, R15): forwards the
 * session-derived resource + thread id + raw title to the Mastra rename route
 * and relays the write failure vocabulary. Deny ladder order matches the read
 * cores: body → session → gate → config → SSRF/host guard → upstream POST →
 * status classification BEFORE any body parse → byte-capped JSON read.
 */
export async function handleHistoryRenameProxyRequest({
  readJson,
  config,
  resolveGate,
  resolveResource,
  fetchImpl = fetch,
  requestSignal,
}: HistoryProxyHandlerInput): Promise<Response> {
  const raw = await readJson().catch(() => undefined)
  const body = parseRenameBody(raw)
  if (body === null) {
    return failureResponse(400, "invalid_body", "refused")
  }

  const resourceId = resolveResource()
  if (resourceId === null) {
    return failureResponse(401, "invalid_session", "refused")
  }

  const gate = await resolveGate()
  if (!gate.seekerEnabled) {
    return failureResponse(403, "gate_denied", "refused")
  }

  if (!config.baseUrl || !config.apiKey) {
    console.warn("[history-proxy] event=refused reason=config_missing")
    return jsonResponse(502, { reason: "unavailable" })
  }
  // Mint the branded base from the SSRF guard's success path; null → this
  // proxy's own 502 unavailable wire. postMastraUpstream demands the brand.
  const baseUrl = validateBaseUrl(
    config.baseUrl,
    config.allowedHosts,
    config.requireAllowlist,
  )
  if (baseUrl === null) {
    console.warn("[history-proxy] event=refused reason=ssrf_blocked")
    return jsonResponse(502, { reason: "unavailable" })
  }

  const budgetSignal = AbortSignal.timeout(config.timeoutMs)
  const signal = composeUpstreamAbortSignal([requestSignal, budgetSignal])

  let response: Response
  try {
    response = await postMastraUpstream(fetchImpl, {
      baseUrl,
      apiKey: config.apiKey,
      path: RENAME_UPSTREAM_PATH,
      accept: "application/json",
      body: { resourceId, threadId: body.threadId, title: body.title },
      signal,
    })
  } catch (error) {
    const failure = classifyUpstreamFailure(error, {
      budgetSignal,
      requestSignal,
    })
    if (failure === "timeout") {
      return failureResponse(504, "timeout", "upstream_failed")
    }
    return failureResponse(502, "unavailable", "upstream_failed")
  }

  // Byte-capped read raced against the composed signal, so a stalled body
  // settles on the budget side (timeout) instead of outliving it.
  const readBody = () =>
    Promise.race([
      readJsonCapped(response, HISTORY_RENAME_MAX_RESPONSE_BYTES),
      undefinedOnAbort(signal),
    ])

  // Status BEFORE body parse: a mapped status relays its reason only when the
  // upstream JSON carries it. Everything else — reasonless 404 (route absent
  // in the deploy window), 503 writes_disabled, 401/500 — is `unavailable`.
  if (
    response.status === 400 ||
    response.status === 403 ||
    response.status === 404
  ) {
    const reason = ((await readBody()) as { reason?: unknown } | undefined)
      ?.reason
    if (response.status === 400 && reason === "invalid_title") {
      return failureResponse(400, "invalid_title", "upstream_rejected")
    }
    if (response.status === 403 && reason === "thread_forbidden") {
      return failureResponse(403, "thread_forbidden", "upstream_rejected")
    }
    if (response.status === 404 && reason === "thread_not_found") {
      return failureResponse(404, "thread_not_found", "upstream_rejected")
    }
    return failureResponse(502, "unavailable", "upstream_failed")
  }
  if (response.status === 504) {
    return failureResponse(504, "timeout", "upstream_failed")
  }
  if (response.status !== 200) {
    return failureResponse(502, "unavailable", "upstream_failed")
  }

  const result = (await readBody()) as
    | { ok?: unknown; title?: unknown }
    | undefined
  // Field-by-field projection: only `ok: true` with a string title is a
  // success — anything else on a 200 is a contract break, a retryable outage.
  if (
    result === undefined ||
    typeof result !== "object" ||
    result === null ||
    result.ok !== true ||
    typeof result.title !== "string"
  ) {
    const reason = budgetSignal.aborted ? "timeout" : "unavailable"
    return failureResponse(
      reason === "timeout" ? 504 : 502,
      reason,
      "upstream_failed",
    )
  }
  return jsonResponse(200, { ok: true, title: result.title })
}
