import type { SearchResult } from "./search"
import type { WatchSearchResultClickAnalytics } from "./watch-search-analytics-contract"

export function buildWatchSearchResultClickRumContext(
  result: SearchResult,
  analytics: WatchSearchResultClickAnalytics,
): Record<string, boolean | number | string> {
  const context: Record<string, boolean | number | string> = {
    "watch_search.result_position": Math.max(1, Math.floor(analytics.position)),
    "watch_search.result_source": analytics.resultSource,
    "watch_search.result_type": result.type,
    "watch_search.search_request_id": analytics.searchRequestId,
  }

  addBoundedContext(context, "watch_search.result_id", result.id)
  addBoundedContext(context, "watch_search.result_slug", result.slug)
  addBoundedContext(context, "watch_search.result_title", result.title, 160)
  addBoundedContext(
    context,
    "watch_search.route_language_slug",
    analytics.routeLanguageSlug,
  )
  addBoundedContext(
    context,
    "watch_search.search_language_slug",
    analytics.searchLanguageSlug,
  )
  addBoundedContext(
    context,
    "watch_search.search_language_english_name",
    analytics.searchLanguageEnglishName,
  )

  return context
}

function addBoundedContext(
  context: Record<string, boolean | number | string>,
  key: string,
  value: string | null | undefined,
  maxLength = 120,
): void {
  if (typeof value !== "string") return
  const normalized = value.replace(/[\r\n\t]/g, " ").trim()
  if (!normalized) return
  context[key] =
    normalized.length > maxLength
      ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
      : normalized
}
