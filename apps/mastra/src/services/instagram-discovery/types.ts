import type { FirecrawlClientFailure } from "../firecrawl-client"

export const MAX_DISCOVERY_TEXT_LENGTH = 1024
export const MAX_INSTAGRAM_HASHTAGS = 30
export const DISCOVERY_QUERY_FAILURE_CODES = [
  "config_missing",
  "auth_failed",
  "network_error",
  "rate_limited",
  "rejected",
  "parse_error",
  "invalid_response",
  "search_failed",
] as const

export type InstagramMediaType = "post" | "reel" | "tv"

/** Signals from the keyword classifier for a single post. */
export type MatchSignals = {
  isAiGenerated: boolean
  isChristian: boolean
  /** True when the caption reads as commentary/news/tutorial about AI content. */
  isCommentary: boolean
  matchedAi: string[]
  matchedChristian: string[]
  matchedCommentary: string[]
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
