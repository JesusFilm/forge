import { type SearchResult } from "./queries"

// TV search surface constants. Locale is hardcoded "en" (apps/tv CLAUDE.md), and
// TV renders only semantic/keyword-fallback hits as one kind, so result_source
// is the constant "semantic" — the client can't distinguish server retrievers.
const RESULT_SOURCE = "semantic"
const ROUTE_LANGUAGE_SLUG = "en"
const SEARCH_LANGUAGE_SLUG = "en"
const SEARCH_LANGUAGE_ENGLISH_NAME = "English"
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
 * leak, and the raw query text is never included. Mirrors web's
 * buildWatchSearchResultClickRumContext, with TV's achievable subset + constants.
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
    "watch_search.result_source": RESULT_SOURCE,
    "watch_search.route_language_slug": ROUTE_LANGUAGE_SLUG,
    "watch_search.search_language_slug": SEARCH_LANGUAGE_SLUG,
    "watch_search.search_language_english_name": SEARCH_LANGUAGE_ENGLISH_NAME,
  }
}

function capText(value: string, maxLength: number): string {
  const normalized = value.replace(/[\r\n\t]/g, " ").trim()
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized
}
