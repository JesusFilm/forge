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
 * ACCEPTED RISK (v1, do NOT "fix" here): this endpoint has NO inbound auth gate
 * and NO rate limit. The chat origin is world-reachable HTTPS (an unadvertised
 * Railway-generated domain — no jesusfilm.org DNS, no Cloudflare, no auth), so
 * URL obscurity + a small trusted audience is the ONLY thing limiting reach —
 * that is the absence of a gate, not a gate. Each turn is a ~90s paid
 * generation, so an open proxy is a cost-amplification surface; the one lever
 * applied here is a prompt-length cap. A real inbound auth gate AND a per-caller
 * rate/concurrency cap are HARD PREREQUISITES before the audience widens at all.
 * See docs/brainstorms/2026-06-25-chat-wire-seeker-route-requirements.md
 * (Dependencies / R5) and the feat-205 plan.
 *
 * Logging is plain-string `[seeker-proxy] event=… reason=…` (Railway logsV2
 * silences JSON-stringified payloads from Next.js runtime route handlers). No
 * raw exception text, upstream body, or threadId/conversationId is interpolated
 * into logs (log-injection + thread-id confidentiality).
 */

import { env, isSeekerChatEnabled, seekerTimeoutMs } from "@/config/env"
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

// Cost-amplification bound under the accepted unauth posture (R5 defers the
// rate/concurrency cap, not input bounds). A single caller must not be able to
// POST a multi-megabyte prompt into a ~90s paid generation.
const MAX_PROMPT_CHARS = 8000
const MAX_CONVERSATION_ID_CHARS = 200

/** Server-resolved Seeker proxy configuration (the bearer + base URL never
 * leave the server). Built from env in `POST`; injected directly in tests. */
export type SeekerProxyConfig = {
  enabled: boolean
  baseUrl?: string
  apiKey?: string
  allowedHosts?: string
  timeoutMs: number
}

/** Inputs to the testable proxy core — the request-body reader, resolved config,
 * the server-resolved memory resource, an injectable fetch, and the inbound
 * abort signal. */
export type SeekerProxyHandlerInput = {
  readJson: () => Promise<unknown>
  config: SeekerProxyConfig
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

// Loopback hosts may use http: — the bearer never leaves the machine, so the
// cleartext concern doesn't apply, and this is what local Mastra dev serves.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

// Railway private-network hosts may also use http: — Mastra has no public
// domain, the WireGuard mesh encrypts transport, and Railway issues no TLS
// cert for *.railway.internal.
const RAILWAY_INTERNAL_SUFFIX = ".railway.internal"

// True full-label suffix match: a bare endsWith would also admit empty-label
// hosts (".railway.internal", "a..railway.internal"), which parse fine in the
// WHATWG URL parser and would otherwise slip past the scheme floor.
function isRailwayInternalHost(host: string): boolean {
  return (
    host.endsWith(RAILWAY_INTERNAL_SUFFIX) &&
    !host.startsWith(".") &&
    !host.includes("..")
  )
}

/**
 * SSRF guard. The base URL must be `https:` — the bearer rides this request, so
 * an `http:` base would egress it in cleartext — EXCEPT loopback hosts (local
 * dev) and `*.railway.internal` hosts (the prod transport: Railway private
 * networking is plain HTTP at the app layer over a WireGuard-encrypted mesh,
 * and Mastra deliberately has no public https domain). When an allowlist is set
 * the host must be in it. An unset allowlist trusts the operator-set host
 * (admin parity; `redirect:"error"` still blocks off-host hops) but the scheme
 * floor applies regardless.
 */
function hostAllowed(
  baseUrl: string,
  allowedHostsCsv: string | undefined,
): boolean {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  const privateHttp =
    url.protocol === "http:" &&
    (LOOPBACK_HOSTS.has(host) || isRailwayInternalHost(host))
  if (url.protocol !== "https:" && !privateHttp) return false
  if (!allowedHostsCsv) return true
  const allowed = new Set(
    allowedHostsCsv
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
  return allowed.has(host)
}

/**
 * The testable proxy core. Always returns a 200 SSE Response (carrying a
 * terminal `error` frame on any failure) EXCEPT a 400 for a malformed body.
 */
export async function handleSeekerProxyRequest({
  readJson,
  config,
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
        // Gate order (defense in depth): enable flag → config present → SSRF.
        if (!config.enabled || !config.baseUrl || !config.apiKey) {
          fail("config_missing")
          return
        }
        if (!hostAllowed(config.baseUrl, config.allowedHosts)) {
          fail("ssrf_blocked")
          return
        }

        const budgetSignal = AbortSignal.timeout(config.timeoutMs)
        // Compose the budget, the caller's signal, and the handler-owned abort
        // (fired by cancel()) so ANY of the three tears down the upstream fetch.
        const signal = AbortSignal.any(
          requestSignal
            ? [requestSignal, budgetSignal, upstreamAbort.signal]
            : [budgetSignal, upstreamAbort.signal],
        )

        let response: Response
        try {
          response = await fetchImpl(new URL("/forge-seeker", config.baseUrl), {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.apiKey}`,
              "content-type": "application/json",
              accept: "text/event-stream",
            },
            body: JSON.stringify({
              prompt: text,
              threadId: conversationId,
              resourceId,
            }),
            redirect: "error",
            signal,
          })
        } catch (error) {
          if (budgetSignal.aborted) return fail("timeout")
          if (requestSignal?.aborted) return fail("cancelled")
          const name = (error as { name?: string } | null | undefined)?.name
          return fail(name === "TimeoutError" ? "timeout" : "network_error")
        }

        // Classify the upstream HTTP status BEFORE the stream-parse path:
        // model_key_missing arrives as a 503 JSON body, auth as 401/403 — none
        // are in-stream SSE frames. A verbatim-relay parser would drop them.
        if (response.status === 401 || response.status === 403) {
          return fail("auth_failed")
        }
        if (response.status === 503) {
          // The composed signal bounds fetch(), NOT a body read on an
          // already-received Response — race the json() read against it so a
          // slow 503 body can't outlive the budget.
          const abortedReason = new Promise<"config_missing">((resolve) => {
            if (signal.aborted) return resolve("config_missing")
            signal.addEventListener("abort", () => resolve("config_missing"), {
              once: true,
            })
          })
          const parsedReason = response
            .json()
            .then((b: { reason?: unknown }) =>
              b?.reason === "model_key_missing"
                ? ("model_key_missing" as const)
                : ("config_missing" as const),
            )
            .catch(() => "config_missing" as const)
          const reason = await Promise.race([parsedReason, abortedReason])
          return fail(reason)
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
            if (budgetSignal.aborted) fail("timeout")
            else if (requestSignal?.aborted) fail("cancelled")
            else {
              const name = (error as { name?: string } | null | undefined)?.name
              fail(name === "TimeoutError" ? "timeout" : "network_error")
            }
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
 * session `sub` when signed in, else the rolling anonymous id. The subject is
 * used as a memory PARTITION KEY only — never for authorization (R7). */
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
      enabled: isSeekerChatEnabled(),
      baseUrl: env.SEEKER_MASTRA_BASE_URL,
      apiKey: env.SEEKER_MASTRA_API_KEY,
      allowedHosts: env.SEEKER_MASTRA_ALLOWED_HOSTS,
      timeoutMs: seekerTimeoutMs(),
    },
    resourceId: resolution.resourceId,
    anonSetCookie: resolution.anonIdToSet
      ? serializeAnonIdCookie(resolution.anonIdToSet)
      : undefined,
    requestSignal: request.signal,
  })
}
