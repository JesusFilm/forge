import type { PinterestSearchErrorCode } from "../pinterest-search-client"

/** A raw RSS <item> from a Pinterest board feed, fields still HTML-encoded. */
export type PinterestRawItem = {
  title?: string | null
  link?: string | null
  pubDate?: string | null
  description?: string | null
  /** The board this item came from (set by the client, not the feed). */
  boardName?: string | null
  boardUrl?: string | null
}

/** A normalized Pinterest pin. */
export type PinterestPin = {
  pinId: string
  /** Canonical pin URL. */
  url: string
  caption: string
  thumbnailUrl: string | null
  /** ISO publish timestamp (best-effort, from RSS pubDate). */
  publishedAt: string | null
  boardName: string | null
  boardUrl: string | null
  hashtags: string[]
  matchedAi: string[]
  matchedChristian: string[]
}

export type BoardFailure = {
  board: string
  /** Client error code, or "board_failed" for non-client errors. */
  code: PinterestSearchErrorCode | "board_failed"
  message: string
}

export type PinterestDiscoveryTotals = {
  candidates: number
  pins: number
  deduped: number
  /** Deduped pins dropped because they read as commentary, not a creation. */
  excludedCommentary: number
  qualified: number
}

export type PinterestDiscoveryReport = {
  schemaVersion: "1"
  kind: "pinterest-ai-christian-discovery"
  reportId: string
  mastraRunId: string
  startedAt: string
  finishedAt: string
  boards: string[]
  totals: PinterestDiscoveryTotals
  boardFailures: BoardFailure[]
  pins: PinterestPin[]
}
