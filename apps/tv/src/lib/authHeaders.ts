// SYNC: mirrors apps/mobile/src/lib/authHeaders.ts. The one TV difference is the
// gated operation NAME — TV's search query is `query SemanticSearch`, mobile's is
// `query Search`. Scope to TV's name or the bearer never attaches (or, worse if
// copied wrong, attaches nowhere and search 401s).

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
export const SEARCH_OPERATION_NAME = "SemanticSearch"

/**
 * Bearer scoped to the gated Search operation only. The consumer bearer is admin's
 * rate-limit identity (`consumer:<key>`, one shared 60/min bucket); since every
 * install ships the same key, only SemanticSearch (rejected anonymously) gets it.
 * Attaching it to public operations would funnel the whole fleet into one bucket.
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
