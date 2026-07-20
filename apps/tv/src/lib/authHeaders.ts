// SYNC: mirrors apps/mobile/src/lib/authHeaders.ts. The one TV difference is the
// legacy operation NAME — TV's old search query was `query SemanticSearch`,
// mobile's was `query Search`.

/**
 * Consumer-bearer header builder retained for the temporary search shim.
 * Absent token returns the anonymous shape so the app still boots and public
 * queries work where no key is provisioned.
 */
export function buildAuthHeaders(
  token: string | undefined,
): Record<string, string> {
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

/** Legacy search operation name retained until TV search is rebuilt. */
export const SEARCH_OPERATION_NAME = "SemanticSearch"

/**
 * Bearer scoped to the legacy Search operation only. The consumer bearer is
 * admin's rate-limit identity (`consumer:<key>`, one shared 60/min bucket).
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
