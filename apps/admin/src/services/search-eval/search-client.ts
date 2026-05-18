/**
 * Search client for the eval harness.
 *
 * Calls admin's public `GET /api/search` endpoint and returns a list of
 * `SearchResult` rows ready for the harness to feed to the pairwise
 * judge. Runs from any environment that can reach `ADMIN_BASE_URL`
 * (default `http://localhost:3003`); no auth required because
 * admin's REST search is public + rate-limited.
 *
 * Snippets are truncated to 200 codepoints here so downstream code
 * never has to think about token bloat. Truncation is codepoint-safe
 * (emoji/CJK don't slice mid-character).
 */

import { SearchResponseSchema } from "./schemas"
import type { SearchResult } from "./types"

/**
 * Per-request abort cap. Long enough to cover admin's slowest hybrid
 * paths under load (semantic + 4 retrievers + RRF + dedup) but short
 * enough that a stuck connection inside a 1500-query full run can't
 * stall the whole harness.
 */
const SEARCH_REQUEST_TIMEOUT_MS = 30_000

/**
 * Retry parameters mirror `judge.ts`. Search calls retry on the same
 * three classes (5xx, 429, transport) — admin's `GET /api/search` is
 * rate-limited at 30/min/IP via Redis, so a high-throughput rebaseline
 * or full run will routinely hit 429s without retry. The backoff cap
 * matches admin's sliding window.
 */
const MAX_RETRY_ATTEMPTS = 3
const RETRY_AFTER_CAP_MS = 30_000
const RETRY_BASE_DELAY_MS = 500

/** Default top-K. Plan §R3 fixes the harness at top-20. */
export const SEARCH_DEFAULT_LIMIT = 20

/** Max snippet codepoints sent to the judge. Plan §R3. */
export const SNIPPET_MAX_CODEPOINTS = 200

/**
 * Discriminated error class so callers can branch on `code` rather
 * than regex-matching messages. Mirrors `EmbeddingsBatchError` from
 * `embeddings.service.ts`.
 */
export class SearchClientError extends Error {
  constructor(
    readonly code:
      | "rate_limited"
      | "validation"
      | "server_error"
      | "transport"
      | "timeout"
      | "response_invalid",
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SearchClientError"
  }
}

export type SearchClientOptions = {
  /** Top-K results requested. Defaults to 20. Capped at admin's MAX_LIMIT=50. */
  limit?: number
  /** Optional pipeline-mode passthrough (`hybrid` | `keyword-first`).
   *  Omit for admin's default (`hybrid`). */
  mode?: "hybrid" | "keyword-first"
  /** Optional content-type filter passthrough. Omit for both. */
  contentType?: "video" | "experience"
  /** Override per-request timeout. Mostly for tests. */
  timeoutMs?: number
}

export type SearchClient = {
  search: (
    query: string,
    locale: string,
    options?: SearchClientOptions,
  ) => Promise<SearchResult[]>
}

export type CreateSearchClientOptions = {
  /** Base URL of the admin app (e.g. `http://localhost:3003`). Trailing
   *  slash optional. */
  baseUrl: string
  /** Override `fetch` for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Override max retry attempts. Tests use 1 to assert single-shot
   *  failure paths. Default 3. */
  maxAttempts?: number
  /** Override sleep between retries. Tests stub it to zero so retries
   *  are instant. */
  sleep?: (ms: number) => Promise<void>
  /** Optional logger; emits structured retry events. */
  logger?: { warn: (message: string) => void; info: (message: string) => void }
  /** Caller-side single bearer attached as `Authorization: Bearer <key>`
   *  to every request. Should be one of admin's own `SEARCH_API_KEYS`
   *  CSV entries when calling production / staging admin. Omit for
   *  anonymous (works during dual-accept; will 401 after the
   *  `SEARCH_AUTH_REQUIRED=true` flip). */
  bearer?: string
}

/**
 * Build a search client bound to a specific admin base URL.
 *
 * The factory shape (vs a top-level function) lets tests inject a
 * stub `fetchImpl` without `vi.stubGlobal`, and callers can plumb
 * one client through the runner without rebuilding the URL each call.
 */
const noopLogger = { warn: () => {}, info: () => {} }

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function createSearchClient(
  options: CreateSearchClientOptions,
): SearchClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "")
  const fetchImpl = options.fetchImpl ?? fetch
  const maxAttempts = options.maxAttempts ?? MAX_RETRY_ATTEMPTS
  const sleep = options.sleep ?? defaultSleep
  const logger = options.logger ?? noopLogger
  const baseHeaders: Record<string, string> = {
    accept: "application/json",
  }
  if (options.bearer != null && options.bearer.length > 0) {
    baseHeaders.authorization = `Bearer ${options.bearer}`
  }

  return {
    async search(query, locale, opts = {}) {
      if (query.length === 0) {
        throw new SearchClientError("validation", "query is required")
      }
      if (locale.length === 0) {
        throw new SearchClientError("validation", "locale is required")
      }

      const url = buildSearchUrl(baseUrl, query, locale, opts)
      const timeoutMs = opts.timeoutMs ?? SEARCH_REQUEST_TIMEOUT_MS
      const failures: string[] = []

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let response: Response
        try {
          response = await fetchImpl(url, {
            method: "GET",
            headers: baseHeaders,
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === "TimeoutError") {
            failures.push(`attempt ${attempt}: timeout after ${timeoutMs}ms`)
            if (attempt < maxAttempts) {
              await sleep(backoffMs(attempt))
              continue
            }
            throw new SearchClientError(
              "timeout",
              `search request timed out after ${timeoutMs}ms (${maxAttempts} attempts)`,
              undefined,
              cause,
            )
          }
          failures.push(
            `attempt ${attempt}: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
          if (attempt < maxAttempts) {
            await sleep(backoffMs(attempt))
            continue
          }
          throw new SearchClientError(
            "transport",
            `search transport error after ${maxAttempts} attempts: ${failures.join(" | ")}`,
            undefined,
            cause,
          )
        }

        // Non-2xx classification with retry decision.
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < maxAttempts) {
            const retryAfter = parseRetryAfterMs(
              response.headers.get("retry-after"),
            )
            const wait = retryAfter ?? backoffMs(attempt)
            failures.push(`attempt ${attempt}: status ${response.status}`)
            logger.info(
              `[search-eval] event=search.retry attempt=${attempt} status=${response.status} wait_ms=${wait}`,
            )
            await sleep(wait)
            continue
          }

          const message = await safeReadErrorMessage(response)
          if (response.status === 400) {
            throw new SearchClientError("validation", message, 400)
          }
          if (response.status === 429) {
            throw new SearchClientError(
              "rate_limited",
              `search rate limit exceeded (429) after ${attempt} attempts: ${message}`,
              429,
            )
          }
          if (response.status >= 500) {
            throw new SearchClientError(
              "server_error",
              `search server error (${response.status}) after ${attempt} attempts: ${message}`,
              response.status,
            )
          }
          throw new SearchClientError(
            "server_error",
            `unexpected status ${response.status}: ${message}`,
            response.status,
          )
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch (cause) {
          throw new SearchClientError(
            "response_invalid",
            "search response was not valid JSON",
            response.status,
            cause,
          )
        }

        const validated = SearchResponseSchema.safeParse(payload)
        if (!validated.success) {
          throw new SearchClientError(
            "response_invalid",
            `search response did not match expected shape: ${validated.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")}`,
            response.status,
          )
        }

        return validated.data.results.map(truncateSnippet)
      }

      // Unreachable; the loop either returns or throws.
      throw new SearchClientError(
        "server_error",
        `search exhausted ${maxAttempts} attempts: ${failures.join(" | ")}`,
      )
    },
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value == null) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)
  }
  return null
}

function backoffMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_AFTER_CAP_MS)
}

function buildSearchUrl(
  baseUrl: string,
  query: string,
  locale: string,
  opts: SearchClientOptions,
): string {
  const url = new URL(`${baseUrl}/api/search`)
  url.searchParams.set("q", query)
  url.searchParams.set("locale", locale)
  url.searchParams.set("limit", String(opts.limit ?? SEARCH_DEFAULT_LIMIT))
  if (opts.mode != null) url.searchParams.set("mode", opts.mode)
  if (opts.contentType != null) url.searchParams.set("type", opts.contentType)
  return url.toString()
}

async function safeReadErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body?.error === "string") return body.error
  } catch {
    // fall through to generic message
  }
  return `HTTP ${response.status}`
}

/**
 * Codepoint-safe truncation. JavaScript's `string.slice(0, n)` cuts
 * by UTF-16 code units, which can split a surrogate pair (emoji,
 * non-BMP CJK) and produce invalid output. `Array.from(s)` yields
 * codepoints; rejoining is faithful.
 */
export function truncateSnippet<T extends { snippet: string | null }>(
  result: T,
): T {
  if (result.snippet == null) return result
  const codepoints = Array.from(result.snippet)
  if (codepoints.length <= SNIPPET_MAX_CODEPOINTS) return result
  return {
    ...result,
    snippet: codepoints.slice(0, SNIPPET_MAX_CODEPOINTS).join(""),
  }
}

// Validation now uses SearchResponseSchema from ./schemas — shared with
// baseline.ts and calibration.ts so the contract has one source of truth.
