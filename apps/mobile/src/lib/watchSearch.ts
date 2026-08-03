import { CombinedGraphQLErrors } from "@apollo/client/errors"

import type {
  SearchResponse,
  SearchResult,
  WatchSearchResultItem,
  WatchSearchWire,
} from "./queries"

// Pure, React-free mapping for the watchSearch contract (admin #1622), so the
// nullable-wire-row → non-null-UI-row narrowing, the request input, and the
// error copy are unit testable without Apollo or the native Datadog SDK.

/**
 * Language inputs take a `language.slug` ("english"), NOT a BCP-47 tag ("en"):
 * a tag matches no language row, so every result returns UNAVAILABLE with a
 * null playbackId. See docs/solutions/.../language-identity-on-slug-not-bcp47.
 */
export const SEARCH_LANGUAGE_SLUG = "english"

export type WatchSearchInputArgs = {
  query: string
  offset: number
  limit: number
  clientRequestId?: string
}

/**
 * Omits `targetLanguageSlug` (an explicit target kills admin's query-named-
 * language inference, so "jesus in spanish" would stop working) and
 * `routeLanguageSlug` (no mobile equivalent; it outranks display).
 */
export function buildWatchSearchInput({
  query,
  offset,
  limit,
  clientRequestId,
}: WatchSearchInputArgs) {
  return {
    query,
    displayLanguageSlug: SEARCH_LANGUAGE_SLUG,
    ...(clientRequestId ? { clientRequestId } : {}),
    limit,
    offset,
  }
}

/**
 * Snippets come from admin's video/scene descriptions, which are CMS-authored
 * and may carry markup. RN `<Text>` renders tags literally, so strip them —
 * mirrors web's htmlToPlainText, minus the DOMParser branch RN has no use for.
 */
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
}

// Require a letter or `/` after `<` so ordinary prose ("a < b") survives, and
// loop until stable: one pass over `<<b>b>` reassembles a live `<b>`.
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g

export function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null
  let text = value.replace(/<br\s*\/?>/gi, " ")
  let previous: string
  do {
    previous = text
    text = text.replace(HTML_TAG, "")
  } while (text !== previous)
  // ONE pass over all entities: a sequence of per-entity replaces would decode
  // `&amp;lt;` twice, turning escaped text back into a live `<`.
  text = text
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|apos|#39);/gi,
      (m) => HTML_ENTITIES[m.toLowerCase()] ?? m,
    )
    .replace(/\s+/g, " ")
    .trim()
  return text.length > 0 ? text : null
}

/**
 * Narrows one wire row to the UI shape, or null when admin omitted a field the
 * card and the routing branch read unconditionally (mirrors web's mapper).
 */
export function mapWatchSearchResult(
  item: WatchSearchResultItem,
): SearchResult | null {
  if (!item.type || !item.id || !item.slug || !item.title) return null
  return {
    type: item.type,
    id: item.id,
    slug: item.slug,
    title: item.title,
    imageUrl: item.imageUrl ?? null,
    snippet: stripHtml(item.snippet),
    startSeconds: item.startSeconds ?? null,
    playbackId: item.playbackId ?? null,
    score: item.score ?? null,
    label: item.label ?? null,
    childCount: item.childCount ?? null,
  }
}

/**
 * Whole-response mapping. `requestedQuery`/`requestedOffset` back-fill the
 * echo fields so a sparse response still yields a usable page cursor.
 */
export function mapWatchSearchResponse(
  response: WatchSearchWire,
  requestedQuery: string,
  requestedOffset: number,
): SearchResponse {
  const returned = response?.results ?? []
  const results = returned.flatMap((item) => {
    const mapped = mapWatchSearchResult(item)
    return mapped ? [mapped] : []
  })
  return {
    query: response?.query ?? requestedQuery,
    // An empty page can't advance the fallback cursor, so honouring hasMore
    // would refetch the same offset forever, spending a token each tap.
    hasMore: returned.length === 0 ? false : (response?.hasMore ?? false),
    // Advance by rows RETURNED, not rows kept — a dropped row would otherwise
    // shift the cursor back and re-fetch duplicates.
    nextOffset: response?.nextOffset ?? requestedOffset + returned.length,
    results,
    // Telemetry passthrough (feat-334): nullable end to end, absence never throws.
    requestId: response?.requestId ?? null,
    latencyMs: response?.latencyMs ?? null,
    degraded: response?.degraded ?? null,
    searchMode: response?.searchMode ?? null,
  }
}

/**
 * User-facing copy for a failed search. Admin returns these in a 200 body, and
 * Apollo v4 throws CombinedGraphQLErrors. It never sets a domain `code`: the
 * rate limiter stamps `extensions.http.statusCode` and thrown service errors
 * mask to INTERNAL_SERVER_ERROR, so branch on what is actually sent.
 */
export function parseSearchError(error: unknown): string {
  if (!CombinedGraphQLErrors.is(error))
    return "Search failed. Please try again."

  const extensions = error.errors[0]?.extensions
  const status = (extensions?.http as { statusCode?: unknown } | undefined)
    ?.statusCode

  if (status === 429) return "Too many requests. Please try again in a minute."
  if (typeof status === "number" && status >= 500) {
    return "Search is temporarily unavailable. Please try again."
  }
  if (extensions?.code === "INTERNAL_SERVER_ERROR") {
    return "Search is temporarily unavailable. Please try again."
  }
  return "Search failed. Please try again."
}
