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
