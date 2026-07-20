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

/** Legacy search operation name retained until mobile search is rebuilt. */
export const SEARCH_OPERATION_NAME = "Search"

/**
 * Bearer scoped to the legacy Search operation only. The consumer bearer is
 * admin's rate-limit identity (`consumer:<key>`, one shared 60/min bucket);
 * since every install ships the same key, never attach it to general public
 * operations.
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
