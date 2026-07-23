/**
 * Server-side SSE proxy to the internal `/forge-seeker` route (feat-205).
 *
 * Holds the Mastra service bearer + base URL SERVER-SIDE (never the browser),
 * checks the base host against an SSRF allowlist before fetch, sets
 * `redirect:"error"`, and relays Seeker's SSE frames to the browser. Every
 * failure — a closed gate, a bad upstream HTTP status, the outbound timeout, a
 * transport drop, or an upstream `error` frame — is normalized into a single
 * terminal `error { reason }` frame on this proxy's own 200 SSE channel, so the
 * client has exactly ONE parse path (the only non-SSE response is a 400 for a
 * malformed request body).
 *
 * feat-208 adds server-resolved memory keying: every send carries a
 * `resourceId` (`user:<sub>` / `anon:<uuid>` — see src/auth/anon-id.ts) so
 * Seeker threads persist per user, and the upstream `thread_forbidden` /
 * `thread_limit` gate reasons pass through to distinct client notices.
 *
 * ACCESS POSTURE (feat-233): an inbound per-user auth gate NOW EXISTS — the
 * seeker dogfood gate (kill switch + signed-in verified email + the
 * SEEKER_ALLOWED_EMAILS env allowlist), enforced on EVERY request via the
 * injected gate resolver before config checks or any upstream fetch. The chat
 * origin remains world-reachable HTTPS and each granted turn is still a ~90s
 * paid generation, so the cost-amplification surface is now bounded by the
 * allowlisted dogfood roster + the prompt-length cap rather than URL
 * obscurity. A per-caller rate/concurrency cap REMAINS an open prerequisite
 * before the audience widens at all — the R15 grant log is the interim
 * volume signal. See
 * docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md
 * (Dependencies / R5) and the feat-205 + feat-233 plans.
 *
 * Logging is plain-string `[seeker-proxy] event=… reason=…` (Railway logsV2
 * silences JSON-stringified payloads from Next.js runtime route handlers). No
 * raw exception text, upstream body, or threadId/conversationId is interpolated
 * into logs (log-injection + thread-id confidentiality).
 */

import { env, seekerTimeoutMs } from "@/config/env"
import { resolveSeekerGate, type SeekerGateDecision } from "@/lib/seeker-gate"
import {
  classifyUpstreamFailure,
  composeUpstreamAbortSignal,
  MAX_CONVERSATION_ID_CHARS,
  postMastraUpstream,
  readJsonCapped,
  undefinedOnAbort,
  validateBaseUrl,
} from "@/lib/server/mastra-upstream"
import { encodeSseFrame, readSseStream } from "@/lib/sse"
import type { ReplyFailureReason } from "@/lib/conversations"
import {
  CHAT_ANON_ID_COOKIE,
  getCookieValue,
  resolveSeekerResource,
  serializeAnonIdCookie,
} from "@/auth/anon-id"
import {
  CHAT_SESSION_COOKIE,
  readChatSessionCookie,
} from "@/auth/session-cookie"

export const dynamic = "force-dynamic"

// Cost-amplification bound (R5 defers the rate/concurrency cap, not input
// bounds) on a multi-megabyte prompt into a ~90s paid generation. The
// conversation-id bound is the shared MAX_CONVERSATION_ID_CHARS.
const MAX_PROMPT_CHARS = 8000

// Byte cap (UTF-8 bytes) on the 503 error-body read (OOM-guard law; feat-282's
// hardening delta). The `{reason}` envelope is tiny, so 64 KiB is generous;
// over-cap reads map to config_missing, same as any parse failure.
const SEEKER_ERROR_BODY_MAX_BYTES = 64 * 1024

/** Server-resolved Seeker proxy configuration (the bearer + base URL never
 * leave the server). Built from env in `POST`; injected directly in tests.
 * The kill switch is no longer here — the gate resolver owns it (feat-233). */
export type SeekerProxyConfig = {
  baseUrl?: string
  apiKey?: string
  allowedHosts?: string
  timeoutMs: number
}

/** Inputs to the testable proxy core — the request-body reader, resolved config,
 * the gate resolver, the server-resolved memory resource, an injectable fetch,
 * and the inbound abort signal. */
export type SeekerProxyHandlerInput = {
  readJson: () => Promise<unknown>
  config: SeekerProxyConfig
  /**
   * Resolves the feat-233 seeker gate (kill switch + signed-in verified email
   * + env-allowlist membership), closed over the caller's identity + surface
   * by `POST`; injectable fake in tests. Any deny emits one `gate_denied` frame.
   */
  resolveGate: () => Promise<SeekerGateDecision>
  /**
   * Server-resolved memory resource (feat-208): `user:<sub>` or `anon:<uuid>`,
   * never client-supplied. ALWAYS sent upstream — the proxy never falls back
   * to Mastra's shared dogfood resource.
   */
  resourceId: string
  /** Serialized anon-id Set-Cookie to attach to the SSE response (rolling
   * 30-day lifetime — re-issued on every anonymous send). */
  anonSetCookie?: string
  fetchImpl?: typeof fetch
  /** Inbound request signal — aborts the upstream fetch when the caller disconnects. */
  requestSignal?: AbortSignal
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function isProxyBody(
  value: unknown,
): value is { text: string; conversationId: string } {
  if (typeof value !== "object" || value === null) return false
  const v = value as { text?: unknown; conversationId?: unknown }
  if (typeof v.text !== "string" || v.text.length === 0) return false
  if (typeof v.conversationId !== "string" || v.conversationId.length === 0) {
    return false
  }
  if (v.text.length > MAX_PROMPT_CHARS) return false
  if (v.conversationId.length > MAX_CONVERSATION_ID_CHARS) return false
  return true
}

/**
 * The testable proxy core. Always returns a 200 SSE Response (carrying a
 * terminal `error` frame on any failure) EXCEPT a 400 for a malformed body.
 */
export async function handleSeekerProxyRequest({
  readJson,
  config,
  resolveGate,
  resourceId,
  anonSetCookie,
  fetchImpl = fetch,
  requestSignal,
}: SeekerProxyHandlerInput): Promise<Response> {
  const raw = await readJson().catch(() => undefined)
  if (!isProxyBody(raw)) {
    return jsonResponse(400, { error: "text and conversationId are required" })
  }
  const { text, conversationId } = raw

  const encoder = new TextEncoder()
  let closed = false
  // Handler-owned so cancel() (and a terminal frame) can ACTIVELY tear down the
  // upstream fetch, not just rely on requestSignal propagating — otherwise a
  // disconnect leaves the ~90s paid generation draining to the budget ceiling.
  const upstreamAbort = new AbortController()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(frame))
        } catch {
          closed = true
        }
      }
      // Emit exactly one terminal error frame then stop. Logs the reason.
      const fail = (reason: ReplyFailureReason) => {
        console.warn(`[seeker-proxy] event=proxy_error reason=${reason}`)
        enqueue(encodeSseFrame("error", { reason }))
      }
      const close = () => {
        if (closed) return
        try {
          controller.close()
        } catch {
          // Already closed by a concurrent cancel — nothing to do.
        }
        closed = true
      }

      try {
        // Gate order (defense in depth): kill switch + per-user gate → config
        // present → SSRF.
        const gate = await resolveGate()
        if (!gate.seekerEnabled) {
          // One reason for EVERY deny cause (KTD2) — the frame stays
          // non-probing; the [seeker-gate] R15 log codes carry the detail.
          fail("gate_denied")
          return
        }
        if (!config.baseUrl || !config.apiKey) {
          fail("config_missing")
          return
        }
        // Mint the branded base from the SSRF guard's success path; null → the
        // proxy's own ssrf_blocked wire. postMastraUpstream demands the brand.
        const baseUrl = validateBaseUrl(config.baseUrl, config.allowedHosts)
        if (baseUrl === null) {
          fail("ssrf_blocked")
          return
        }

        const budgetSignal = AbortSignal.timeout(config.timeoutMs)
        // Compose the budget, the caller's signal, and the handler-owned abort
        // (fired by cancel()) so ANY of the three tears down the upstream fetch.
        const signal = composeUpstreamAbortSignal([
          requestSignal,
          budgetSignal,
          upstreamAbort.signal,
        ])

        let response: Response
        try {
          response = await postMastraUpstream(fetchImpl, {
            baseUrl,
            apiKey: config.apiKey,
            path: "/forge-seeker",
            accept: "text/event-stream",
            body: { prompt: text, threadId: conversationId, resourceId },
            signal,
          })
        } catch (error) {
          const failure = classifyUpstreamFailure(error, {
            budgetSignal,
            requestSignal,
          })
          // This proxy's wire mapping over the shared discriminant.
          return fail(failure === "network" ? "network_error" : failure)
        }

        // Classify the upstream HTTP status BEFORE the stream-parse path:
        // model_key_missing arrives as a 503 JSON body, auth as 401/403 — none
        // are in-stream SSE frames. A verbatim-relay parser would drop them.
        if (response.status === 401 || response.status === 403) {
          return fail("auth_failed")
        }
        if (response.status === 503) {
          // The composed signal bounds fetch(), NOT a body read on a received
          // Response — race the byte-capped read against it so a slow 503 body
          // can't outlive the budget (over-cap/parse/abort → config_missing).
          const body = await Promise.race([
            readJsonCapped(response, SEEKER_ERROR_BODY_MAX_BYTES),
            undefinedOnAbort(signal),
          ])
          const reason = (body as { reason?: unknown } | undefined)?.reason
          return fail(
            reason === "model_key_missing"
              ? "model_key_missing"
              : "config_missing",
          )
        }
        // 404 = route disabled upstream; treat as config/unavailable.
        if (response.status === 404) return fail("config_missing")
        if (!response.ok || response.body == null) {
          return fail("network_error")
        }

        // Relay path. token_delta + result re-emit verbatim (sources[] sanitized
        // at the render layer); only timeout/generation_failed arrive in-stream.
        // After a terminal frame we abort upstream so it can't wedge the client.
        let terminalEmitted = false
        try {
          await readSseStream(response.body, (event, data) => {
            if (closed || terminalEmitted) return
            if (event === "token_delta") {
              enqueue(encodeSseFrame("token_delta", data))
              return
            }
            if (event === "result") {
              terminalEmitted = true
              enqueue(encodeSseFrame("result", data))
              upstreamAbort.abort()
              return
            }
            if (event === "error") {
              terminalEmitted = true
              const reason = (data as { reason?: unknown })?.reason
              // Pass through the reasons the client maps to distinct notices
              // (feat-208 adds the thread gate pair); everything else stays
              // generation_failed so unknown upstream tokens never reach the UI.
              fail(
                reason === "timeout" ||
                  reason === "thread_forbidden" ||
                  reason === "thread_limit"
                  ? reason
                  : "generation_failed",
              )
              upstreamAbort.abort()
            }
          })
        } catch (error) {
          if (!terminalEmitted) {
            const failure = classifyUpstreamFailure(error, {
              budgetSignal,
              requestSignal,
            })
            fail(failure === "network" ? "network_error" : failure)
          }
          return
        }
        // Upstream ended without a terminal frame — surface it, never silent.
        if (!terminalEmitted) fail("parse_error")
      } finally {
        close()
      }
    },
    cancel() {
      // Caller disconnected → stop emitting AND actively abort the upstream
      // fetch (don't rely only on requestSignal propagating) so a paid
      // generation isn't left draining to the budget ceiling.
      closed = true
      upstreamAbort.abort()
    },
  })

  // Set-Cookie MUST be attached when the Response is constructed — headers
  // cannot be added once body streaming begins (feat-208 rolling anon id).
  const headers = new Headers({
    // `connection` is a forbidden hop-by-hop response header (Fetch spec) — the
    // platform manages keep-alive; setting it here is dead at best.
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform, no-store",
  })
  if (anonSetCookie) headers.set("set-cookie", anonSetCookie)

  return new Response(stream, { status: 200, headers })
}

/** Next.js App Router entry point. Builds config from server env and resolves
 * the memory resource from the request's cookies (feat-208): the verified
 * session `sub` when signed in, else the rolling anonymous id. The sub stays a
 * memory PARTITION KEY (R7), but the same identity now ALSO feeds the seeker
 * gate — the authorized feat-233/R13 carve-out, closed over in resolveGate. */
export async function POST(request: Request): Promise<Response> {
  const cookieHeader = request.headers.get("cookie")
  const identity = await readChatSessionCookie(
    getCookieValue(cookieHeader, CHAT_SESSION_COOKIE),
  )
  const resolution = resolveSeekerResource({
    identity,
    anonCookieValue: getCookieValue(cookieHeader, CHAT_ANON_ID_COOKIE),
  })
  return handleSeekerProxyRequest({
    readJson: () => request.json(),
    config: {
      baseUrl: env.SEEKER_MASTRA_BASE_URL,
      apiKey: env.AI_CHAT_MASTRA_API_KEY,
      allowedHosts: env.SEEKER_MASTRA_ALLOWED_HOSTS,
      timeoutMs: seekerTimeoutMs(),
    },
    resolveGate: () => resolveSeekerGate(identity, { surface: "route" }),
    resourceId: resolution.resourceId,
    anonSetCookie: resolution.anonIdToSet
      ? serializeAnonIdCookie(resolution.anonIdToSet)
      : undefined,
    requestSignal: request.signal,
  })
}
