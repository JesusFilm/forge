import type { PinterestRawItem } from "./pinterest-discovery/types"

import { sleepUnlessAborted } from "./abortable-sleep"

/**
 * Pinterest exposes a free public RSS feed for any public board at
 * `https://<host>/<user>/<board>.rss`. This client fetches that feed and splits
 * it into raw <item> records; the parser normalizes them. No API key required.
 */

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 30_000

export const PINTEREST_SEARCH_ERROR_CODES = [
  "not_found",
  "upstream_failed",
  "invalid_response",
] as const

export type PinterestSearchErrorCode =
  (typeof PINTEREST_SEARCH_ERROR_CODES)[number]

export class PinterestSearchError extends Error {
  constructor(
    readonly code: PinterestSearchErrorCode,
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "PinterestSearchError"
  }
}

export type FetchBoardOptions = {
  timeoutMs?: number
  maxAttempts?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

function boardPageUrl(boardUrl: string): URL {
  let url: URL
  try {
    url = new URL(boardUrl.trim())
  } catch {
    throw new PinterestSearchError(
      "invalid_response",
      "Pinterest board URL must be valid",
    )
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== "https:" ||
    (hostname !== "pinterest.com" && !hostname.endsWith(".pinterest.com"))
  ) {
    throw new PinterestSearchError(
      "invalid_response",
      "Pinterest board URL must use HTTPS and a pinterest.com host",
    )
  }

  url.search = ""
  url.hash = ""
  return url
}

/** Build the .rss feed URL for a board page URL. */
export function boardFeedUrl(boardUrl: string): string {
  const url = boardPageUrl(boardUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, "")}.rss`
  return url.toString()
}

/** Best-effort human board name from a board URL (`/user/board/`). */
export function boardNameFromUrl(boardUrl: string): string | null {
  const match = boardPageUrl(boardUrl)
    .toString()
    .match(/pinterest\.[^/]+\/([^?#]+?)\/?$/i)
  return match ? decodeURIComponent(match[1]!) : null
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))
  return m ? m[1]! : null
}

/** Split the RSS document into raw <item> records (still HTML-encoded). */
export function parseRssItems(xml: string): PinterestRawItem[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
  return blocks.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    pubDate: extractTag(block, "pubDate"),
    description: extractTag(block, "description"),
  }))
}

/**
 * Fetch a Pinterest board's RSS feed and return its raw items, tagged with the
 * board name/url for downstream attribution. Retries transient failures.
 */
export async function fetchBoardFeed(
  boardUrl: string,
  options: FetchBoardOptions = {},
): Promise<PinterestRawItem[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  const normalizedBoardUrl = boardPageUrl(boardUrl).toString()
  const feedUrl = boardFeedUrl(normalizedBoardUrl)
  const boardName = boardNameFromUrl(normalizedBoardUrl)

  let response: Response | null = null
  let lastTransportError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetchImpl(feedUrl, {
        method: "GET",
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
        redirect: "error",
        signal,
      })
    } catch (cause) {
      if (signal.aborted) {
        throw new PinterestSearchError(
          "upstream_failed",
          "Pinterest feed request exceeded its deadline",
          true,
          cause,
        )
      }
      lastTransportError = cause
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw new PinterestSearchError(
        "upstream_failed",
        `Pinterest feed request failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        true,
        cause,
      )
    }
    if (response.status >= 500 && attempt < maxAttempts) {
      if (!(await sleepUnlessAborted(sleep, backoffMs(attempt), signal))) {
        throw new PinterestSearchError(
          "upstream_failed",
          "Pinterest feed request exceeded its deadline",
          true,
        )
      }
      continue
    }
    break
  }

  if (response == null) {
    throw new PinterestSearchError(
      "upstream_failed",
      `Pinterest feed request failed: ${
        lastTransportError instanceof Error
          ? lastTransportError.message
          : String(lastTransportError)
      }`,
      true,
      lastTransportError,
    )
  }

  if (response.status === 404 || response.status === 403) {
    throw new PinterestSearchError(
      "not_found",
      `Pinterest board feed not available (HTTP ${response.status}) — board may be private`,
    )
  }
  if (!response.ok) {
    throw new PinterestSearchError(
      "upstream_failed",
      `Pinterest feed returned HTTP ${response.status}`,
      response.status >= 500,
    )
  }

  const xml = await response.text().catch((cause) => {
    throw new PinterestSearchError(
      "invalid_response",
      "Pinterest feed body could not be read",
      false,
      cause,
    )
  })
  if (!/<rss[\s>]|<feed[\s>]/i.test(xml)) {
    throw new PinterestSearchError(
      "invalid_response",
      "Pinterest feed was not RSS/XML",
    )
  }

  return parseRssItems(xml).map((item) => ({
    ...item,
    boardName,
    boardUrl: normalizedBoardUrl,
  }))
}

export const _internals = { extractTag, parseRssItems, boardFeedUrl }
