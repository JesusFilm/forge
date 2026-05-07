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

import type { SearchResponse, SearchResult } from "./types"

/**
 * Per-request abort cap. Long enough to cover admin's slowest hybrid
 * paths under load (semantic + 4 retrievers + RRF + dedup) but short
 * enough that a stuck connection inside a 1500-query full run can't
 * stall the whole harness.
 */
const SEARCH_REQUEST_TIMEOUT_MS = 30_000

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
      | "validation_failed",
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
}

/**
 * Build a search client bound to a specific admin base URL.
 *
 * The factory shape (vs a top-level function) lets tests inject a
 * stub `fetchImpl` without `vi.stubGlobal`, and callers can plumb
 * one client through the runner without rebuilding the URL each call.
 */
export function createSearchClient(
  options: CreateSearchClientOptions,
): SearchClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "")
  const fetchImpl = options.fetchImpl ?? fetch

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

      let response: Response
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "TimeoutError") {
          throw new SearchClientError(
            "timeout",
            `search request timed out after ${timeoutMs}ms`,
            undefined,
            cause,
          )
        }
        throw new SearchClientError(
          "transport",
          cause instanceof Error ? cause.message : String(cause),
          undefined,
          cause,
        )
      }

      if (response.status === 429) {
        throw new SearchClientError(
          "rate_limited",
          "search rate limit exceeded (429)",
          429,
        )
      }
      if (response.status === 400) {
        const message = await safeReadErrorMessage(response)
        throw new SearchClientError("validation", message, 400)
      }
      if (response.status >= 500) {
        const message = await safeReadErrorMessage(response)
        throw new SearchClientError("server_error", message, response.status)
      }
      if (!response.ok) {
        const message = await safeReadErrorMessage(response)
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
          "validation_failed",
          "search response was not valid JSON",
          response.status,
          cause,
        )
      }

      if (!isSearchResponse(payload)) {
        throw new SearchClientError(
          "validation_failed",
          "search response did not match expected shape",
          response.status,
        )
      }

      return payload.results.map(truncateSnippet)
    },
  }
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

/**
 * Lightweight runtime validator for admin's search response. Avoids
 * a Zod dep for a shape we control on both ends — admin's REST contract
 * is documented in `apps/admin/src/services/hybrid-search.service.ts`.
 */
function isSearchResponse(value: unknown): value is SearchResponse {
  if (value == null || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.results)) return false
  if (typeof v.query !== "string") return false
  if (typeof v.searchMode !== "string") return false
  if (typeof v.hasMore !== "boolean") return false
  return v.results.every(isSearchResult)
}

function isSearchResult(value: unknown): value is SearchResult {
  if (value == null || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  if (v.type !== "video" && v.type !== "experience") return false
  if (typeof v.id !== "string") return false
  if (typeof v.slug !== "string") return false
  if (typeof v.title !== "string") return false
  if (typeof v.snippet !== "string") return false
  if (typeof v.score !== "number") return false
  return true
}
