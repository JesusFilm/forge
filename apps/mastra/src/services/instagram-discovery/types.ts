import type { FirecrawlClientFailure } from "../firecrawl-client"

export type InstagramMediaType = "post" | "reel" | "tv"

/** Signals from the keyword classifier for a single post. */
export type MatchSignals = {
  isAiGenerated: boolean
  isChristian: boolean
  matchedAi: string[]
  matchedChristian: string[]
}

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
  code: FirecrawlClientFailure["reason"] | "search_failed"
  message: string
}

export type DiscoveryTotals = {
  candidates: number
  instagram: number
  deduped: number
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
