import type { FirecrawlSearchErrorCode } from "../firecrawl-search-client"

// Signals type now lives with the shared classifier; re-exported for callers
// that still import it from the Instagram types module.
export type { MatchSignals } from "../discovery/classifier"

export type InstagramMediaType = "post" | "reel" | "tv"

/** A normalized Instagram post discovered via Firecrawl search. */
export type InstagramPost = {
  url: string
  shortcode: string
  mediaType: InstagramMediaType
  authorHandle: string | null
  authorName: string | null
  caption: string
  hashtags: string[]
  /**
   * Best-effort publish timestamp (ISO string). Instagram rarely exposes a
   * reliable timestamp through search snippets, so this is frequently null
   * unless scrape metadata includes it.
   */
  publishedAt: string | null
  thumbnailUrl: string | null
  matchedAi: string[]
  matchedChristian: string[]
}

export type DiscoveryQueryFailure = {
  query: string
  /** Firecrawl client error code, or "search_failed" for non-Firecrawl errors. */
  code: FirecrawlSearchErrorCode | "search_failed"
  message: string
}

export type DiscoveryTotals = {
  candidates: number
  instagram: number
  deduped: number
  /** Deduped posts dropped because they read as commentary, not a creation. */
  excludedCommentary: number
  qualified: number
}

export type DiscoveryReport = {
  schemaVersion: "1"
  kind: "instagram-ai-christian-discovery"
  reportId: string
  mastraRunId: string
  startedAt: string
  finishedAt: string
  queries: string[]
  totals: DiscoveryTotals
  queryFailures: DiscoveryQueryFailure[]
  posts: InstagramPost[]
}
