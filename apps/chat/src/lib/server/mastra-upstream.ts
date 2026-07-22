/**
 * Shared Mastra upstream primitives for the chat proxies (feat-282 PR 1).
 * The seeker send proxy (`app/api/seeker/route.ts`) and the history read
 * proxies (`app/api/history/history-proxy.ts`) call the same Mastra base URL
 * and must apply the same SSRF/scheme discipline before any outbound fetch;
 * this module owns those primitives so a fix lands once (previously
 * `hostAllowed` was exported from the seeker ROUTE file — a route doubling as
 * a library). Pure — no env reads, no side effects at import — and
 * `server-only`-guarded like the app's other server modules, so future
 * additions (PR 2 brings bearer-adjacent helpers) cannot leak into a client
 * bundle. Everything request-shaped (deny ladders, budgets, response
 * channels, the dogfood gate) stays per-proxy by design — see Ruling 2 in
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
