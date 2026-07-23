/**
 * Shared Mastra upstream transport for the chat proxies (feat-282). The
 * seeker send proxy (`app/api/seeker/route.ts`) and the history read proxies
 * (`app/api/history/history-proxy.ts`) call the same Mastra base URL and must
 * apply the same SSRF/scheme, fetch-shape, abort, and byte-cap discipline on
 * every outbound call; this module owns those primitives so a fix lands once
 * (previously `hostAllowed` was exported from the seeker ROUTE file — a route
 * doubling as a library). Pure — no env reads, no side effects at import —
 * and `server-only`-guarded like the app's other server modules, so the
 * bearer-adjacent helpers cannot leak into a client bundle. Everything
 * request-shaped (deny ladders, budgets, byte-cap sizes, response channels,
 * the per-proxy wire mapping over the failure discriminant, the dogfood
 * gate) stays per-proxy by design — see Ruling 2 in
 * docs/handoffs/2026-07-21-chat-architecture-review-rulings.md.
 */

import "server-only"

/** Upper bound on the client-supplied conversation id (the server thread id —
 * same value, feat-208 contract; mirrors Mastra's own cap). Shared so the two
 * proxies' bounds cannot drift apart. */
export const MAX_CONVERSATION_ID_CHARS = 200

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
export function hostAllowed(
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

// Phantom brand — never exists at runtime; only validateBaseUrl attaches it.
declare const validatedBaseUrlBrand: unique symbol

/**
 * A base URL proven to pass `hostAllowed` (the https/scheme floor with its
 * loopback + `*.railway.internal` carve-outs and optional host allowlist).
 * `postMastraUpstream` demands this brand, so a caller cannot hand it an
 * unvalidated base and egress the bearer to an unchecked host — skipping the
 * guard is a compile error, not a calling convention (feat-294; the
 * guard-then-use extraction law). Obtainable only via `validateBaseUrl`.
 */
export type ValidatedBaseUrl = string & {
  readonly [validatedBaseUrlBrand]: true
}

/**
 * Mint the branded base iff `hostAllowed` passes; `null` otherwise. The ONLY
 * SANCTIONED source of `ValidatedBaseUrl` — the sole `as ValidatedBaseUrl` cast
 * lives here, behind the guard. The brand stops an unvalidated string from
 * reaching `postMastraUpstream` by ACCIDENT; it is not tamper-proof (a
 * deliberate `as ValidatedBaseUrl` elsewhere, or an `any`-typed base, still
 * forges it — keep the single-cast invariant under review). Callers map `null`
 * onto their OWN deny wire (seeker `ssrf_blocked` frame; history 502
 * `unavailable`); the per-proxy deny ladder stays at the call site by design.
 */
export function validateBaseUrl(
  baseUrl: string,
  allowedHostsCsv: string | undefined,
): ValidatedBaseUrl | null {
  return hostAllowed(baseUrl, allowedHostsCsv)
    ? (baseUrl as ValidatedBaseUrl)
    : null
}

/** The shared shape of an outbound Mastra call. `accept` is the one header
 * the proxies legitimately differ on (SSE relay vs JSON read); everything
 * else — method, bearer, content-type, redirect policy — is fixed here. */
export type MastraUpstreamRequest = {
  baseUrl: ValidatedBaseUrl
  apiKey: string
  path: string
  accept: string
  body: unknown
  signal: AbortSignal
}

/**
 * The shared fetch shape for every chat → Mastra call: `new URL(path, base)`,
 * POST, `Bearer` auth, JSON content-type, `redirect:"error"` (no off-host
 * hops with the bearer attached), and the composed abort signal. The base is a
 * `ValidatedBaseUrl` — the type forces every caller through `validateBaseUrl`,
 * so an unguarded base cannot even be passed. The helper additionally pins the
 * composed URL to the base's origin (below) to close the path-escapes-the-base
 * gap the base guard never covered; it never re-runs the guard itself.
 */
export function postMastraUpstream(
  fetchImpl: typeof fetch,
  request: MastraUpstreamRequest,
): Promise<Response> {
  const url = new URL(request.path, request.baseUrl)
  // Origin pin: an absolute or scheme-relative `path` would DISCARD the
  // hostAllowed-validated base and egress the bearer off-host — fail closed
  // before attaching it. Unreachable from callers passing literal paths.
  if (url.origin !== new URL(request.baseUrl).origin) {
    throw new TypeError("postMastraUpstream: path escapes the base origin")
  }
  return fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${request.apiKey}`,
      "content-type": "application/json",
      accept: request.accept,
    },
    body: JSON.stringify(request.body),
    redirect: "error",
    signal: request.signal,
  })
}

/**
 * Compose the outbound abort signal from the proxy's abort sources (budget,
 * caller disconnect, a handler-owned controller), skipping absent ones. A
 * single remaining source is returned as-is (identity — no wrapper), so a
 * proxy with only the budget signal keeps exactly today's object. Callers
 * must supply at least one present signal: an all-absent input composes a
 * signal that never aborts (an unbounded fetch), not an error.
 */
export function composeUpstreamAbortSignal(
  signals: ReadonlyArray<AbortSignal | undefined>,
): AbortSignal {
  const present = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  )
  return present.length === 1 ? present[0]! : AbortSignal.any(present)
}

/** The transport-failure discriminant both proxies classify into. Each proxy
 * maps it onto its own wire (seeker: SSE `error{reason}` frames; history:
 * KTD8 HTTP statuses) — the mapping never lives here. */
export type UpstreamFailureDiscriminant = "timeout" | "cancelled" | "network"

/**
 * Classify a rejected upstream call into the shared discriminant. Check
 * precedence is the seeker route's, now canonical for both proxies: the
 * budget signal (timeout) is consulted first, then the caller's signal
 * (cancelled), and only then the error name — so an abort race always
 * resolves to the signal that actually fired, not the error's spelling.
 */
export function classifyUpstreamFailure(
  error: unknown,
  signals: { budgetSignal: AbortSignal; requestSignal?: AbortSignal },
): UpstreamFailureDiscriminant {
  if (signals.budgetSignal.aborted) return "timeout"
  if (signals.requestSignal?.aborted) return "cancelled"
  const name = (error as { name?: string } | null | undefined)?.name
  return name === "TimeoutError" ? "timeout" : "network"
}

/**
 * Byte-capped buffered JSON read (OOM-guard law): streams the body with a
 * byte counter and ABORTS the socket (`reader.cancel()`) the instant it
 * crosses `maxBytes` — `Content-Length` is never trusted. Any failure
 * (over-cap, transport, parse) resolves `undefined`; the caught error is
 * NEVER logged (a JSON.parse SyntaxError can embed raw body fragments).
 */
export async function readJsonCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const body = response.body
  if (body == null) return undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    reader = body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value !== undefined) {
        received += value.byteLength
        if (received > maxBytes) {
          await reader.cancel()
          return undefined
        }
        chunks.push(value)
      }
    }
    const joined = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      joined.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(joined)) as unknown
  } catch {
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Lock already released by cancel — nothing to do.
    }
  }
}

/** Resolve `undefined` when the signal aborts — raced against a body read so
 * a slow upstream body cannot outlive the composed budget. */
export function undefinedOnAbort(signal: AbortSignal): Promise<undefined> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(undefined)
    signal.addEventListener("abort", () => resolve(undefined), { once: true })
  })
}
