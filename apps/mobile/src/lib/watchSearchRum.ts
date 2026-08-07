import { type SearchResult } from "./queries"
import { SEARCH_LANGUAGE_SLUG } from "./watchSearch"

/** Action name shared with web and TV so cross-app dashboards join on it. */
export const WATCH_SEARCH_RESULT_CLICKED_ACTION = "watch_search.result_clicked"

const MAX_TITLE_LENGTH = 160

export type WatchSearchResultClickOptions = {
  /** 1-based rank of the clicked card within the visible results list. */
  position: number
  /** Client-generated correlation id shared with the per-search log. */
  searchRequestId: string
}

/**
 * Bounded, PII-free RUM context for a search-result click. Every key is assigned
 * by name (never a `{...result}` spread) so a future SearchResult field can't
 * leak, and the raw query text is never included. Mirrors TV's builder minus
 * result_source (mobile can't attest one) and search_language_english_name.
 */
export function buildWatchSearchResultClickContext(
  result: SearchResult,
  { position, searchRequestId }: WatchSearchResultClickOptions,
): Record<string, number | string> {
  return {
    "watch_search.result_position": Math.max(1, Math.floor(position)),
    "watch_search.result_id": result.id,
    "watch_search.result_slug": result.slug,
    "watch_search.result_title": capText(result.title, MAX_TITLE_LENGTH),
    "watch_search.result_type": result.type,
    "watch_search.search_request_id": searchRequestId,
    // route_language_slug is deliberately absent: buildWatchSearchInput never
    // sends routeLanguageSlug, so reporting one would fabricate a request field.
    "watch_search.search_language_slug": SEARCH_LANGUAGE_SLUG,
  }
}

function capText(value: string, maxLength: number): string {
  const normalized = value.replace(/[\r\n\t]/g, " ").trim()
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized
}
