// TV-only for now: mobile still gates on the retired `Search` name and has not
// migrated. Each app also ships its OWN fleet key value — never copy a token.

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

/** Search operation name. Renamed with admin's Query.search → watchSearch (#1622).
 *  MUST equal the `query <name>` in WATCH_SEARCH or the bearer attaches nowhere. */
export const SEARCH_OPERATION_NAME = "WatchSearch"

/**
 * Scoped to the search op only. Not an auth requirement (watchSearch is public)
 * — it buys the per-device rate-limit bucket; on other public ops it would pool
 * the whole fleet into one.
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
