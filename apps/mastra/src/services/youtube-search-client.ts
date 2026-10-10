import { z } from "zod"

import { sleepUnlessAborted } from "./abortable-sleep"
import type { YouTubeRawItem } from "./youtube-discovery/types"

const DEFAULT_YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3"
const DEFAULT_YOUTUBE_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 30_000

export const YOUTUBE_SEARCH_ERROR_CODES = [
  "config_missing",
  "auth_failed",
  "rate_limited",
  "not_found",
  "upstream_failed",
  "invalid_response",
] as const

export type YouTubeSearchErrorCode = (typeof YOUTUBE_SEARCH_ERROR_CODES)[number]

export class YouTubeSearchError extends Error {
  constructor(
    readonly code: YouTubeSearchErrorCode,
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "YouTubeSearchError"
  }
}

export type YouTubeRequestOptions = {
  apiKey?: string
  baseUrl?: string
  timeoutMs?: number
  maxAttempts?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

// Tolerant envelope — we only depend on `items[]`; `.passthrough()` keeps the
// per-item shape differences (search vs playlistItems) intact for the parser.
const YouTubeListResponseSchema = z
  .object({
    items: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough()

const ChannelsResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            contentDetails: z
              .object({
                relatedPlaylists: z
                  .object({ uploads: z.string().optional() })
                  .passthrough()
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

function endpoint(baseUrl: string, path: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL(path, normalized)
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after")
  const seconds = header == null ? Number.NaN : Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS)
  }
  return backoffMs(attempt)
}

/** YouTube signals quota/rate problems via a 403 with a specific reason. */
function isQuotaBody(bodyText: string): boolean {
  return /quotaExceeded|rateLimitExceeded|userRateLimitExceeded/i.test(bodyText)
}

type GetParams = Record<string, string | number | undefined>

async function youTubeGet(
  path: string,
  params: GetParams,
  options: YouTubeRequestOptions,
): Promise<unknown> {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) {
    throw new YouTubeSearchError(
      "config_missing",
      "YOUTUBE_API_KEY is not configured",
    )
  }

  const baseUrl = options.baseUrl ?? DEFAULT_YOUTUBE_BASE_URL
  const timeoutMs = options.timeoutMs ?? DEFAULT_YOUTUBE_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  const url = endpoint(baseUrl, path)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  url.searchParams.set("key", apiKey)

  let response: Response | null = null
  let lastTransportError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal,
      })
    } catch (cause) {
      if (signal.aborted) {
        throw new YouTubeSearchError(
          "upstream_failed",
          "YouTube request exceeded its deadline",
          true,
          cause,
        )
      }
      lastTransportError = cause
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw new YouTubeSearchError(
        "upstream_failed",
        `YouTube request failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        true,
        cause,
      )
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < maxAttempts
    ) {
      if (
        !(await sleepUnlessAborted(
          sleep,
          retryAfterMs(response, attempt),
          signal,
        ))
      ) {
        throw new YouTubeSearchError(
          "upstream_failed",
          "YouTube request exceeded its deadline",
          true,
        )
      }
      continue
    }
    break
  }

  if (response == null) {
    throw new YouTubeSearchError(
      "upstream_failed",
      `YouTube request failed: ${
        lastTransportError instanceof Error
          ? lastTransportError.message
          : String(lastTransportError)
      }`,
      true,
      lastTransportError,
    )
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "")
    if (response.status === 429) {
      throw new YouTubeSearchError(
        "rate_limited",
        "YouTube rate limit exceeded",
        true,
      )
    }
    if (response.status === 403 && isQuotaBody(bodyText)) {
      throw new YouTubeSearchError(
        "rate_limited",
        "YouTube quota exceeded",
        true,
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new YouTubeSearchError(
        "auth_failed",
        "YouTube rejected the API key",
      )
    }
    if (response.status === 404) {
      throw new YouTubeSearchError("not_found", "YouTube resource not found")
    }
    throw new YouTubeSearchError(
      "upstream_failed",
      `YouTube returned HTTP ${response.status}`,
      response.status >= 500,
    )
  }

  return response.json().catch((cause) => {
    throw new YouTubeSearchError(
      "invalid_response",
      "YouTube response was not valid JSON",
      false,
      cause,
    )
  })
}

function parseItems(payload: unknown): YouTubeRawItem[] {
  const parsed = YouTubeListResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new YouTubeSearchError(
      "invalid_response",
      "YouTube list response failed schema validation",
      false,
      parsed.error,
    )
  }
  return (parsed.data.items ?? []) as YouTubeRawItem[]
}

/** Keyword discovery: `search.list` for videos matching a query. */
export async function searchVideos(
  query: string,
  options: YouTubeRequestOptions & { limit?: number } = {},
): Promise<YouTubeRawItem[]> {
  const payload = await youTubeGet(
    "search",
    {
      part: "snippet",
      type: "video",
      q: query,
      maxResults: options.limit ?? 10,
    },
    options,
  )
  return parseItems(payload)
}

/**
 * Resolve a channel reference (channel id `UC…`, `@handle`, or a youtube.com URL)
 * to its uploads playlist id via `channels.list`.
 */
export async function resolveUploadsPlaylist(
  channelRef: string,
  options: YouTubeRequestOptions = {},
): Promise<string> {
  const { param, value } = parseChannelRef(channelRef)
  const payload = await youTubeGet(
    "channels",
    { part: "contentDetails", [param]: value },
    options,
  )
  const parsed = ChannelsResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new YouTubeSearchError(
      "invalid_response",
      "YouTube channels response failed schema validation",
      false,
      parsed.error,
    )
  }
  const uploads =
    parsed.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
  if (!uploads) {
    throw new YouTubeSearchError(
      "not_found",
      `no uploads playlist for channel '${channelRef}'`,
    )
  }
  return uploads
}

/** Trusted-account pull: `playlistItems.list` over a channel's uploads playlist. */
export async function listPlaylistVideos(
  playlistId: string,
  options: YouTubeRequestOptions & { limit?: number } = {},
): Promise<YouTubeRawItem[]> {
  const payload = await youTubeGet(
    "playlistItems",
    {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: options.limit ?? 10,
    },
    options,
  )
  return parseItems(payload)
}

/**
 * Map a channel reference to the right `channels.list` lookup param. Channel ids
 * (`UC…`) use `id`; handles (`@name`) use `forHandle`; bare names fall back to
 * `forHandle` with an `@` prefix.
 */
export function parseChannelRef(ref: string): {
  param: "id" | "forHandle"
  value: string
} {
  const trimmed = ref.trim()

  // youtube.com/channel/UC... → id
  const channelUrl = trimmed.match(/youtube\.com\/channel\/([^/?#]+)/i)
  if (channelUrl) return { param: "id", value: channelUrl[1]! }

  // youtube.com/@handle → forHandle
  const handleUrl = trimmed.match(/youtube\.com\/(@[^/?#]+)/i)
  if (handleUrl) return { param: "forHandle", value: handleUrl[1]! }

  if (trimmed.startsWith("@")) return { param: "forHandle", value: trimmed }
  if (/^UC[\w-]{20,}$/.test(trimmed)) return { param: "id", value: trimmed }

  return { param: "forHandle", value: `@${trimmed}` }
}

export const _internals = { isQuotaBody, parseChannelRef }
