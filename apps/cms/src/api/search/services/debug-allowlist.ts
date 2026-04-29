/**
 * Origin gating for the optional `debug` response payload (feat-109
 * unit 4).
 *
 * The `debug=true` query param surfaces internal scoring detail
 * (per-retriever ranks, fused score, dilution-cap application) per
 * result. Production consumers must NOT see this payload — it leaks
 * implementation detail and would tempt clients to depend on internal
 * scoring constants. Dev / staging origins ARE allowed to see it for
 * operator inspection.
 *
 * Allowlist resolution:
 *  - `SEARCH_DEBUG_ALLOWED_ORIGINS` env (CSV) — explicit allowlist.
 *    When set, only origins in this list are allowed.
 *  - Otherwise: allowed iff `NODE_ENV !== "production"`. Conservative
 *    default — debug works in dev and Railway preview deployments,
 *    and is automatically stripped in production.
 *
 * Fail-closed semantics:
 *  - `origin` undefined → false (non-browser clients with no Origin
 *    header don't get debug, which protects against curl-from-prod
 *    accidentally exposing scoring internals to log scrapers). Mirrors
 *    the yoga-cors institutional learning.
 *
 * **Threat model — the Origin header is NOT an authentication
 *  mechanism.** Browsers set `Origin` automatically and forbid
 *  client-side override, but any non-browser HTTP client (curl,
 *  server-to-server, an MCP tool, an attacker with `nc`) can send
 *  `Origin: <any-allowlisted-host>` and unlock the debug payload.
 *  The gate is therefore best treated as a *soft feature flag* that
 *  prevents accidental browser-based exposure, not as a security
 *  boundary. The payload (per-retriever ranks, fused RRF scores,
 *  dilution-cap state) reveals scoring internals but no secrets,
 *  PII, or credentials. If that risk model ever changes — e.g.
 *  the payload starts carrying user-scoped data — replace this gate
 *  with a server-side authenticated check (signed token, allowlisted
 *  IP range, internal-only network path) before relying on it.
 *
 * **Agent access trade-off.** Because the gate fails closed on
 *  `Origin === undefined`, agent clients (CLI bots, MCP tools, server-
 *  to-server callers) on a deployed dev/staging environment cannot
 *  see the debug payload without explicitly setting an `Origin`
 *  header to an allowlisted value. This is a deliberate consequence
 *  of fail-closed semantics, not an oversight: agents that need debug
 *  on a deployed environment should set `Origin: <allowlisted-origin>`
 *  on their request, or the operator should add a token-based debug
 *  gate as a follow-up.
 */
export function isDebugAllowedForOrigin(origin: string | undefined): boolean {
  if (origin == null || origin.length === 0) return false

  const raw = process.env.SEARCH_DEBUG_ALLOWED_ORIGINS
  if (raw != null && raw.trim().length > 0) {
    const allowlist = raw
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
    return allowlist.includes(origin)
  }

  return process.env.NODE_ENV !== "production"
}
