/**
 * Consumer-bearer header builder. Absent token returns the anonymous shape so
 * the app still boots and public queries work where no key is provisioned.
 */
export function buildAuthHeaders(
  token: string | undefined,
): Record<string, string> {
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

/** Search operation name. Renamed with admin's Query.search → watchSearch (#1622). */
export const SEARCH_OPERATION_NAME = "WatchSearch"

/**
 * Bearer scoped to the search operation only. `watchSearch` is a PUBLIC
 * resolver, so this is not an auth requirement — it buys the per-device
 * rate-limit bucket (`consumer:<key>:v:<viewer_id>`) instead of the coarse,
 * CGNAT-collapsed `public:<ip>` one. On other public ops it would pool the
 * whole fleet into a single bucket.
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
