/**
 * Shared testable cores for the two chat history proxy routes (feat-241):
 * `POST /api/history/list` and `POST /api/history/thread`. Both resolve the
 * caller's resource from the signed session SERVER-SIDE (a client-supplied
 * resource field is never read), enforce the seeker dogfood gate per request
 * (surface "history" — phase scaffolding, comes off in feat-236), and forward
 * to Mastra's bearer-gated history routes with the dedicated
 * `AI_CHAT_MASTRA_API_KEY` lane bearer (KTD2 — never the send-path pool key).
 *
 * POST-shaped so thread ids never appear in URLs (and hence access/CDN logs
 * — scoped to these proxies: feat-209's `/c/<id>` deep-link GET is the one
 * deliberate exception, see that route's docstring);
 * uniform non-probing deny contract (KTD8): 401 `invalid_session` (anonymous,
 * expired, invalid — one shape), 403 `gate_denied` / `thread_forbidden`,
 * 404 `thread_not_found` (only when the upstream body carries that reason — a
 * reasonless 404 is `unavailable`, so a config outage never presents as data
 * loss), 502 `unavailable`, 504 `timeout`. No anon-cookie minting here.
 *
 * Upstream handling per the repo's proxy discipline, via the shared
 * transport in `lib/server/mastra-upstream` (feat-282): https/loopback/
 * railway host guard before any call, the shared POST fetch shape
 * (`redirect:"error"`), shared signal composition + failure classification
 * (this proxy maps the discriminant onto KTD8 statuses), an abort budget
 * clamped to [9s, 10s] (`composeHistoryTimeoutMs`) — millisecond-class reads
 * never inherit the 95s generation ceiling — status classified BEFORE any
 * body parse, and every body read byte-capped via the shared `readJsonCapped`
 * (streamed counter, `reader.cancel()` past the cap; the caught error is
 * never logged; the 2/8 MiB cap SIZES stay here). Logging is enum-only
 * plain-string `[history-proxy] event=… reason=…` — never ids, titles, or
 * body fragments.
 */

import { resolveSeekerResource } from "@/auth/anon-id"
import { type ChatIdentity } from "@/auth/session-cookie"
import {
  env,
  requireSeekerEgressAllowlist,
  seekerTimeoutMs,
} from "@/config/env"
import { type SeekerGateDecision } from "@/lib/seeker-gate"
import {
  classifyUpstreamFailure,
  composeUpstreamAbortSignal,
  MAX_CONVERSATION_ID_CHARS,
  postMastraUpstream,
  readJsonCapped,
  undefinedOnAbort,
  validateBaseUrl,
} from "@/lib/server/mastra-upstream"

/** Ceiling on the composed history read budget (KTD7): these are
 * millisecond-class reads and must not inherit the 95s generation timeout. */
export const HISTORY_READ_TIMEOUT_CEILING_MS = 10_000

/** Floor under the composed budget: SEEKER_TIMEOUT_MS is a SEND-path knob
 * with a documented lower-it escape hatch — letting it drag this budget below
 * Mastra's 8s historyRead would invert the outbound-timeout ordering (the
 * proxy would abort before the route's clean timeout classification). */
export const HISTORY_READ_TIMEOUT_FLOOR_MS = 9_000

/** Clamp the send-path timeout into the history read window [floor, ceiling]
 * (see the two constants above). Pure — exported for direct unit coverage. */
export function composeHistoryTimeoutMs(sendPathTimeoutMs: number): number {
  return Math.max(
    HISTORY_READ_TIMEOUT_FLOOR_MS,
    Math.min(sendPathTimeoutMs, HISTORY_READ_TIMEOUT_CEILING_MS),
  )
}

/** Byte caps on the buffered upstream JSON (OOM-guard law). Sized from the
 * replay contract's honest worst case at ≤3 UTF-8 bytes per UTF-16 code unit:
 * 200 messages × (8,192 text + 5 capped sources + a capped video + JSON
 * envelope), plus feat-366's ONE-message followUps term (the replay wire
 * carries them on the last text-bearing assistant message only) ≈ 7.96 MB —
 * so 8 MiB clears a legitimate non-Latin transcript carrying feat-329 and
 * feat-366 attachments while still bounding a misbehaving upstream.
 * Mastra derives that budget from its own named constants
 * (`AI_CHAT_HISTORY_WORST_CASE_THREAD_BYTES`), measures a maximal SERIALIZED
 * thread against it, and reads THIS FILE to pin its mirror of the 8 MiB value —
 * so lowering this constant alone fails mastra's byte-cap suite rather than
 * silently invalidating the budget. Never raise this cap to fit a payload; the
 * fix is a tighter bound on the producing side. The list page is far smaller. */
export const HISTORY_LIST_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const HISTORY_THREAD_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** Signed-in resource prefix — prefix-check only, never split on ":". */
const USER_RESOURCE_PREFIX = "user:"

const LIST_UPSTREAM_PATH = "/forge-ai-chat-history-list"
const REPLAY_UPSTREAM_PATH = "/forge-ai-chat-history-replay"

/** The closed client-facing failure vocabulary (KTD8). */
export type HistoryProxyFailureReason =
  | "invalid_body"
  | "invalid_session"
  | "gate_denied"
  | "thread_forbidden"
  | "thread_not_found"
  | "unavailable"
  | "timeout"

/** Server-resolved config for the history proxies. History reuses the seeker
 * base URL + host allowlist but carries its OWN lane bearer (KTD2): an unset
 * `AI_CHAT_MASTRA_API_KEY` refuses these routes without touching the send
 * path. Built from env in the route wrappers; injected directly in tests. */
export type HistoryProxyConfig = {
  baseUrl?: string
  apiKey?: string
  allowedHosts?: string
  /** Whether an unset `allowedHosts` DENIES (production) rather than trusting
   * the operator-set host. Carried on the config — not read from env here — so
   * the cores stay injectable and the policy is explicit at every call site. */
  requireAllowlist: boolean
  timeoutMs: number
}

/** Inputs to the testable cores — the body reader, resolved config, the gate
 * resolver (surface "history"), the session-derived resource seam, an
 * injectable fetch, and the inbound abort signal. */
export type HistoryProxyHandlerInput = {
  readJson: () => Promise<unknown>
  config: HistoryProxyConfig
  resolveGate: () => Promise<SeekerGateDecision>
  /** `user:<sub>` for a valid signed session, null otherwise (anonymous,
   * expired, tampered, blank sub — indistinguishable by design, R6/R8). */
  resolveResource: () => string | null
  fetchImpl?: typeof fetch
  requestSignal?: AbortSignal
}

/** Build the history proxy config from env (the route wrappers' default). */
export function buildHistoryProxyConfig(): HistoryProxyConfig {
  return {
    baseUrl: env.SEEKER_MASTRA_BASE_URL,
    apiKey: env.AI_CHAT_MASTRA_API_KEY,
    allowedHosts: env.SEEKER_MASTRA_ALLOWED_HOSTS,
    requireAllowlist: requireSeekerEgressAllowlist(),
    timeoutMs: composeHistoryTimeoutMs(seekerTimeoutMs()),
  }
}

/**
 * Resolve the history resource for a session identity: `user:<sub>` via the
 * canonical builder, or null for anything else. History is signed-in-only —
 * unlike the send path there is NO anon fallback and no cookie minting; a
 * blank-sub identity (which the canonical builder routes to the anon branch)
 * is an invalid session here, never an anonymous read (R5/R8).
 */
export function resolveHistoryResource(
  identity: ChatIdentity | null,
): string | null {
  if (identity === null) return null
  const resolution = resolveSeekerResource({
    identity,
    anonCookieValue: undefined,
  })
  return resolution.resourceId.startsWith(USER_RESOURCE_PREFIX)
    ? resolution.resourceId
    : null
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function failureResponse(
  status: number,
  reason: HistoryProxyFailureReason,
  event: string,
): Response {
  console.warn(`[history-proxy] event=${event} reason=${reason}`)
  return jsonResponse(status, { reason })
}

type HistoryUpstream = {
  path: string
  body: Record<string, unknown>
  maxResponseBytes: number
}

/**
 * The shared deny ladder + forwarder both cores delegate to. Order (KTD7):
 * session → gate → config → SSRF/host guard → upstream POST → status
 * classification BEFORE any body parse → byte-capped JSON read.
 */
async function forwardHistoryRequest(
  {
    config,
    resolveGate,
    resolveResource,
    fetchImpl = fetch,
    requestSignal,
  }: HistoryProxyHandlerInput,
  buildUpstream: (resourceId: string) => HistoryUpstream,
): Promise<Response> {
  // Session first: a valid signed session is the credential (R6). Anonymous,
  // expired, tampered, and blank-sub are ONE non-probing shape (KTD8).
  const resourceId = resolveResource()
  if (resourceId === null) {
    return failureResponse(401, "invalid_session", "refused")
  }

  // Dogfood gate, re-resolved per request (R7 — feat-236 removes this layer).
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

  const upstream = buildUpstream(resourceId)
  const budgetSignal = AbortSignal.timeout(config.timeoutMs)
  const signal = composeUpstreamAbortSignal([requestSignal, budgetSignal])

  let response: Response
  try {
    response = await postMastraUpstream(fetchImpl, {
      baseUrl,
      apiKey: config.apiKey,
      path: upstream.path,
      accept: "application/json",
      body: upstream.body,
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
    // This proxy's wire mapping: cancelled (caller gone — nobody reads the
    // response) folds into 502 unavailable — same observable wire as the old
    // name-based check, since only the budget source throws TimeoutError.
    return failureResponse(502, "unavailable", "upstream_failed")
  }

  // Status BEFORE body parse (KTD8); thread_forbidden/thread_not_found relay
  // only when the upstream JSON carries them — a reasonless 404 (flag off,
  // deploy skew) is `unavailable`, never "your conversations were deleted".
  if (response.status === 403 || response.status === 404) {
    const body = await Promise.race([
      readJsonCapped(response, upstream.maxResponseBytes),
      undefinedOnAbort(signal),
    ])
    const reason = (body as { reason?: unknown } | undefined)?.reason
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

  const body = await Promise.race([
    readJsonCapped(response, upstream.maxResponseBytes),
    undefinedOnAbort(signal),
  ])
  if (body === undefined || typeof body !== "object" || body === null) {
    const reason = budgetSignal.aborted ? "timeout" : "unavailable"
    return failureResponse(
      reason === "timeout" ? 504 : 502,
      reason,
      "upstream_failed",
    )
  }
  return jsonResponse(200, body)
}

/** Body guard for `/api/history/list`: an optional non-negative integer
 * `page`. Client-supplied resource fields are IGNORED, never read (AE10). */
function parseListBody(value: unknown): { page: number } | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as { page?: unknown }
  if (
    v.page !== undefined &&
    (typeof v.page !== "number" || !Number.isInteger(v.page) || v.page < 0)
  ) {
    return null
  }
  return { page: v.page === undefined ? 0 : v.page }
}

/**
 * `POST /api/history/list` core (R5–R9): forwards the session-derived
 * resource + requested page to the Mastra listing route. The page-size
 * constant lives server-side only — the client consumes the returned
 * `perPage`/`hasMore` envelope (KTD6).
 */
export async function handleHistoryListProxyRequest(
  input: HistoryProxyHandlerInput,
): Promise<Response> {
  const raw = await input.readJson().catch(() => undefined)
  const body = parseListBody(raw)
  if (body === null) {
    return failureResponse(400, "invalid_body", "refused")
  }
  return forwardHistoryRequest(input, (resourceId) => ({
    path: LIST_UPSTREAM_PATH,
    body: { resourceId, page: body.page },
    maxResponseBytes: HISTORY_LIST_MAX_RESPONSE_BYTES,
  }))
}

/** Body guard for `/api/history/thread`: a required, bounded conversation id
 * (the server thread id — same value, feat-208 contract). */
function parseThreadBody(value: unknown): { conversationId: string } | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as { conversationId?: unknown }
  if (
    typeof v.conversationId !== "string" ||
    v.conversationId.length === 0 ||
    v.conversationId.length > MAX_CONVERSATION_ID_CHARS
  ) {
    return null
  }
  return { conversationId: v.conversationId }
}

/**
 * `POST /api/history/thread` core (R5–R9, R13): forwards the session-derived
 * resource + conversation id to the Mastra replay route and relays the
 * projected transcript.
 */
export async function handleHistoryThreadProxyRequest(
  input: HistoryProxyHandlerInput,
): Promise<Response> {
  const raw = await input.readJson().catch(() => undefined)
  const body = parseThreadBody(raw)
  if (body === null) {
    return failureResponse(400, "invalid_body", "refused")
  }
  return forwardHistoryRequest(input, (resourceId) => ({
    path: REPLAY_UPSTREAM_PATH,
    body: { resourceId, threadId: body.conversationId },
    maxResponseBytes: HISTORY_THREAD_MAX_RESPONSE_BYTES,
  }))
}
