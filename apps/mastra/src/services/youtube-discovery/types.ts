import type { YouTubeSearchErrorCode } from "../youtube-search-client"

/**
 * Loosely-typed YouTube Data API item. The API client validates the envelope and
 * passes items through with `.passthrough()`, so the parser is the single place
 * that understands the differing shapes of `search.list` vs `playlistItems.list`.
 */
export type YouTubeRawItem = {
  id?: { videoId?: string | null } | string | null
  contentDetails?: { videoId?: string | null } | null
  snippet?: {
    title?: string | null
    description?: string | null
    channelId?: string | null
    channelTitle?: string | null
    publishedAt?: string | null
    resourceId?: { videoId?: string | null } | null
    thumbnails?: Record<string, { url?: string | null } | null> | null
  } | null
}

/** A normalized YouTube video discovered via the Data API. */
export type YouTubeVideo = {
  videoId: string
  /** Canonical watch URL: https://www.youtube.com/watch?v=<videoId>. */
  url: string
  title: string
  description: string
  channelId: string | null
  channelTitle: string | null
  /** Channel page URL for attribution: /channel/<channelId> (null if unknown). */
  authorUrl: string | null
  /** ISO publish timestamp — reliably present from the API (unlike Instagram). */
  publishedAt: string | null
  thumbnailUrl: string | null
  hashtags: string[]
  matchedAi: string[]
  matchedChristian: string[]
}

/** How a single discovery source (a channel, a playlist, or a query) is identified. */
export type DiscoverySourceKind = "channel" | "playlist" | "query"

export type DiscoverySourceFailure = {
  source: string
  kind: DiscoverySourceKind
  /** YouTube client error code, or "source_failed" for non-client errors. */
  code: YouTubeSearchErrorCode | "source_failed"
  message: string
}

export type YouTubeDiscoveryTotals = {
  candidates: number
  videos: number
  deduped: number
  /** Deduped videos dropped because they read as commentary, not a creation. */
  excludedCommentary: number
  qualified: number
}

export type YouTubeDiscoveryReport = {
  schemaVersion: "1"
  kind: "youtube-ai-christian-discovery"
  reportId: string
  mastraRunId: string
  startedAt: string
  finishedAt: string
  channels: string[]
  playlists: string[]
  queries: string[]
  totals: YouTubeDiscoveryTotals
  sourceFailures: DiscoverySourceFailure[]
  videos: YouTubeVideo[]
}
