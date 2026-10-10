import { z } from "zod"

import { sleepUnlessAborted } from "./abortable-sleep"

const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev"
const DEFAULT_FIRECRAWL_TIMEOUT_MS = 60_000
const DEFAULT_MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 30_000

export const FIRECRAWL_SEARCH_ERROR_CODES = [
  "config_missing",
  "auth_failed",
  "rate_limited",
  "upstream_failed",
  "invalid_response",
] as const

export type FirecrawlSearchErrorCode =
  (typeof FIRECRAWL_SEARCH_ERROR_CODES)[number]

export class FirecrawlSearchError extends Error {
  constructor(
    readonly code: FirecrawlSearchErrorCode,
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "FirecrawlSearchError"
  }
}

export type FirecrawlSearchHit = {
  url: string
  title?: string
  description?: string
  markdown?: string
  metadata?: Record<string, unknown>
}

export type RequestFirecrawlSearchOptions = {
  apiKey?: string
  baseUrl?: string
  limit?: number
  maxMarkdownCharacters?: number
  timeoutMs?: number
  /** When true, ask Firecrawl to scrape each result for richer metadata. */
  scrape?: boolean
  maxAttempts?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

// Firecrawl returns a permissive payload; we only depend on `data[].url` and a
// few optional fields. `.passthrough()` keeps unknown fields from breaking parsing.
const FirecrawlSearchResultSchema = z
  .object({
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    markdown: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const FirecrawlSearchResponseSchema = z
  .object({
    success: z.boolean().optional(),
    data: z.array(FirecrawlSearchResultSchema),
  })
  .passthrough()

function searchEndpoint(baseUrl: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL("v1/search", normalized)
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

/**
 * Call Firecrawl's `/v1/search` endpoint for a single query and return
 * normalized hits. Retries transient failures (429, 5xx, transport errors)
 * with exponential backoff up to `maxAttempts`.
 */
export async function requestFirecrawlSearch(
  query: string,
  options: RequestFirecrawlSearchOptions = {},
): Promise<FirecrawlSearchHit[]> {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) {
    throw new FirecrawlSearchError(
      "config_missing",
      "FIRECRAWL_API_KEY is not configured",
    )
  }

  const baseUrl = options.baseUrl ?? DEFAULT_FIRECRAWL_BASE_URL
  const timeoutMs = options.timeoutMs ?? DEFAULT_FIRECRAWL_TIMEOUT_MS
  const limit = options.limit ?? 10
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const fetchImpl = options.fetchImpl ?? fetch
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  const body = {
    query,
    limit,
    ...(options.scrape
      ? { scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }
      : {}),
  }

  let response: Response | null = null
  let lastTransportError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetchImpl(searchEndpoint(baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal,
      })
    } catch (cause) {
      if (signal.aborted) {
        throw new FirecrawlSearchError(
          "upstream_failed",
          "Firecrawl search request exceeded its deadline",
          true,
          cause,
        )
      }
      lastTransportError = cause
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt))
        continue
      }
      throw new FirecrawlSearchError(
        "upstream_failed",
        `Firecrawl search request failed: ${
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
        throw new FirecrawlSearchError(
          "upstream_failed",
          "Firecrawl search request exceeded its deadline",
          true,
        )
      }
      continue
    }
    break
  }

  if (response == null) {
    throw new FirecrawlSearchError(
      "upstream_failed",
      `Firecrawl search request failed: ${
        lastTransportError instanceof Error
          ? lastTransportError.message
          : String(lastTransportError)
      }`,
      true,
      lastTransportError,
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new FirecrawlSearchError(
      "auth_failed",
      "Firecrawl rejected the API key",
    )
  }
  if (response.status === 429) {
    throw new FirecrawlSearchError(
      "rate_limited",
      "Firecrawl rate limit exceeded",
      true,
    )
  }
  if (!response.ok) {
    throw new FirecrawlSearchError(
      "upstream_failed",
      `Firecrawl search returned HTTP ${response.status}`,
      response.status >= 500,
    )
  }

  const payload = await response.json().catch((cause) => {
    throw new FirecrawlSearchError(
      "invalid_response",
      "Firecrawl search response was not valid JSON",
      false,
      cause,
    )
  })

  const parsed = FirecrawlSearchResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new FirecrawlSearchError(
      "invalid_response",
      "Firecrawl search response failed schema validation",
      false,
      parsed.error,
    )
  }

  return parsed.data.data.map((result) => ({
    url: result.url,
    title: result.title,
    description: result.description,
    markdown: result.markdown?.slice(0, options.maxMarkdownCharacters),
    metadata: result.metadata,
  }))
}
