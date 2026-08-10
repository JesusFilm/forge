// Pure, React-free mapping for the watchSearch contract (admin #1622), so the
// nullable-wire-row narrowing and the request input stay unit testable.
// TV-only: mobile has no equivalent module yet.

import { CombinedGraphQLErrors } from "@apollo/client/errors"
import { resolveWatchSearchDisplayTitle } from "@forge/content-display"

import type {
  SearchResponse,
  SearchResult,
  WatchSearchResultItem,
} from "./queries"

/**
 * A language SLUG ("english"), NOT a BCP-47 tag. A tag matches no language row,
 * so every result comes back UNAVAILABLE with a null playbackId.
 */
export const SEARCH_LANGUAGE_SLUG = "english"

export type WatchSearchInputArgs = {
  query: string
  offset: number
  limit: number
  displayLanguageSlug?: string
  clientRequestId?: string
}

/**
 * Sends neither `targetLanguageSlug` (suppresses admin's query-named-language
 * inference, so "jesus in spanish" stops returning Spanish) nor
 * `routeLanguageSlug` (outranks display, breaking availability).
 */
export function buildWatchSearchInput({
  query,
  offset,
  limit,
  displayLanguageSlug = SEARCH_LANGUAGE_SLUG,
  clientRequestId,
}: WatchSearchInputArgs) {
  return {
    query,
    displayLanguageSlug,
    ...(clientRequestId ? { clientRequestId } : {}),
    limit,
    offset,
  }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
}

/**
 * Snippets are CMS-authored and may carry markup; RN `<Text>` renders tags
 * literally, so reduce to plain text. Entities decode in ONE pass (a sequential
 * `&amp;`-then-`&lt;` chain double-unescapes `&amp;lt;` into a live `<`), and
 * tags strip to a fixed point (one pass leaves `<scr<script>ipt>` as `<script`).
 */
export function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null
  let text = value.replace(
    /&(amp|lt|gt|quot|apos|nbsp|#39);/gi,
    (_, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? "",
  )
  text = text.replace(/<br\s*\/?>/gi, " ")
  let previous: string
  do {
    previous = text
    text = text.replace(/<[^>]*>/g, "")
  } while (text !== previous)
  // Nothing angle-bracketed may survive into plain text, including an unclosed
  // `<script` the tag pass cannot match.
  text = text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : null
}

/**
 * Narrows one wire row to the UI shape, or null when admin omitted a field the
 * card and the routing branch read unconditionally (mirrors web's mapper).
 */
export function mapWatchSearchResult(
  item: WatchSearchResultItem,
): SearchResult | null {
  if (!item.type || !item.id || !item.slug) return null
  const title = resolveWatchSearchDisplayTitle({
    title: item.title,
    slug: item.slug,
    isVideo: item.type === "VIDEO",
  })
  if (!title) return null
  return {
    type: item.type,
    id: item.id,
    slug: item.slug,
    title,
    imageUrl: item.imageUrl ?? null,
    snippet: stripHtml(item.snippet),
    startSeconds: item.startSeconds ?? null,
    playbackId: item.playbackId ?? null,
    score: item.score ?? null,
    label: item.label ?? null,
    childCount: item.childCount ?? null,
  }
}

type WatchSearchWireResponse =
  | {
      readonly query?: string | null
      readonly hasMore?: boolean | null
      readonly nextOffset?: number | null
      readonly results?: readonly WatchSearchResultItem[] | null
    }
  | null
  | undefined

/**
 * Whole-response mapping. `requestedQuery`/`requestedOffset` back-fill the echo
 * fields so a sparse response still yields a usable page cursor.
 */
export function mapWatchSearchResponse(
  response: WatchSearchWireResponse,
  requestedQuery: string,
  requestedOffset: number,
): SearchResponse {
  const results = (response?.results ?? []).flatMap((item) => {
    const mapped = mapWatchSearchResult(item)
    return mapped ? [mapped] : []
  })
  return {
    query: response?.query ?? requestedQuery,
    hasMore: response?.hasMore ?? false,
    nextOffset: response?.nextOffset ?? requestedOffset + results.length,
    results,
  }
}

/**
 * Admin sets no domain `extensions.code` here — @envelop/rate-limiter stamps
 * only `extensions.http.statusCode`, and watchSearch is public so auth never
 * throws. Branch on what is actually sent.
 */
export function parseSearchErrorCode(error: unknown): string {
  if (!CombinedGraphQLErrors.is(error)) return "network_error"
  const extensions = error.errors[0]?.extensions
  const status = (extensions?.http as { statusCode?: unknown } | undefined)
    ?.statusCode
  if (status === 429) return "rate_limited"
  if (typeof status === "number" && status >= 500) return "server_error"
  const code = extensions?.code
  return typeof code === "string" ? code : "unknown"
}
