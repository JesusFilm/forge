export const MAX_WATCH_SEARCH_QUERY_CODE_POINTS = 200

export function normalizeWatchSearchQuery(value: string): string {
  return Array.from(value.normalize("NFC").trim())
    .slice(0, MAX_WATCH_SEARCH_QUERY_CODE_POINTS)
    .join("")
}
