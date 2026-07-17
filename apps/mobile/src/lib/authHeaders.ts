/**
 * Consumer-bearer header for admin GraphQL (Query.search requires it once
 * SEARCH_AUTH_REQUIRED is active). Absent token returns the anonymous shape so
 * the app still boots and public queries work where no key is provisioned.
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
 * Bearer scoped to the gated Search operation only. The consumer bearer is admin's
 * rate-limit identity (`consumer:<key>`, one shared 60/min bucket); since every
 * install ships the same key, only Search (rejected anonymously) gets it.
 */
export function authHeadersForOperation(
  operationName: string | undefined,
  token: string | undefined,
  viewerId?: string,
): Record<string, string> {
  if (operationName !== SEARCH_OPERATION_NAME) return {}
  const headers = buildAuthHeaders(token)
  // x-viewer-id lets admin bucket per-install (CGNAT-immune) instead of per-IP;
  // spoofable, so admin treats it as an availability label only.
  if (viewerId) headers["x-viewer-id"] = viewerId
  return headers
}
