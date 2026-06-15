/**
 * Build a URL string that syncs the current search query to the ?q= param.
 * Preserves any other search params already on the URL (e.g., utm_*, locale
 * flags) rather than wiping them.
 */
export function buildSearchUrl(
  pathname: string,
  existingParams: URLSearchParams,
  query: string,
): string {
  const params = new URLSearchParams(existingParams)
  const trimmed = query.trim()
  if (trimmed.length > 0) {
    params.set("q", trimmed)
  } else {
    params.delete("q")
  }
  const serialized = params.toString()
  return serialized.length > 0 ? `${pathname}?${serialized}` : pathname
}
