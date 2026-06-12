/**
 * Consumer-bearer header for admin GraphQL. Admin's Query.search requires a
 * known bearer once SEARCH_AUTH_REQUIRED is active; public queries ignore it.
 * Empty/absent token falls through to the anonymous shape so the app still
 * boots (and public queries still work) where no key is provisioned.
 */
export function buildAuthHeaders(
  token: string | undefined,
): Record<string, string> {
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

/** Operation name of the one admin query gated behind the search bearer. */
export const SEARCH_OPERATION_NAME = "Search"

/**
 * Bearer scoped to the gated Search operation only. On admin's GraphQL seam a
 * consumer bearer becomes the rate-limit identity (`consumer:<key>`, one
 * shared bucket per key value at 60 queries/min), while anonymous requests
 * bucket per device IP. Every install ships the same key, so attaching the
 * header to public queries would funnel the entire fleet's traffic into that
 * single bucket — only Search, which admin rejects anonymously, may carry it.
 */
export function authHeadersForOperation(
  operationName: string | undefined,
  token: string | undefined,
): Record<string, string> {
  if (operationName !== SEARCH_OPERATION_NAME) return {}
  return buildAuthHeaders(token)
}
