import { adminGraphql } from "@forge/admin-graphql"
import client from "@/lib/admin-client"

// Admin's `search(q, locale, type, limit, offset, mode, debug)` is the
// hybrid (semantic + keyword) PUBLIC-tier search surface. Response shape
// keeps `hasMore`, `query`, `searchMode`, and a `results[]` array. Each
// `HybridSearchResult` carries the fields the web consumers already read
// (`id`, `title`, `snippet`, `imageUrl`, `slug`, `type`, `playbackId`,
// `startSeconds`, `score`) — admin's `type` is the upper-case
// `EXPERIENCE | VIDEO` enum, normalised to the lower-case discriminator
// the result-card components expect.

const SEARCH_QUERY = adminGraphql(`
  query Search(
    $q: String!
    $locale: String!
    $limit: Int
    $offset: Int
    $type: HybridSearchContentType
  ) {
    search(q: $q, locale: $locale, limit: $limit, offset: $offset, type: $type) {
      hasMore
      query
      searchMode
      results {
        id
        slug
        title
        snippet
        imageUrl
        playbackId
        startSeconds
        score
        type
      }
    }
  }
`)

export type SearchContentType = "video" | "experience"

export type SearchResult = {
  type: SearchContentType
  id: string
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  startSeconds: number | null
  playbackId: string | null
  score: number
}

export type SearchError = {
  code: string
  message: string
  retryAfterSeconds?: number
}

const MAX_QUERY_LENGTH = 200

// Admin's `HybridSearchContentType` is the SDL-side enum and is encoded
// upper-case on the wire. The web consumer vocabulary is lower-case
// ("video", "experience"); convert both directions at the boundary so
// downstream React + URL handling never sees the upper-case form.
function toAdminContentType(
  type?: SearchContentType,
): "VIDEO" | "EXPERIENCE" | undefined {
  if (type === "video") return "VIDEO"
  if (type === "experience") return "EXPERIENCE"
  return undefined
}

function normalizeResultType(raw: string): SearchContentType {
  return raw === "EXPERIENCE" ? "experience" : "video"
}

// Admin returns `HybridSearchMode` as UPPER (`HYBRID` | `KEYWORD_ONLY`);
// the watch-page banner consumer checks lower-case kebab (`hybrid` |
// `keyword-only`). Normalize at the boundary so the embedding-down
// advisory in SearchModeBanner.tsx fires correctly.
function normalizeSearchMode(raw: string | null | undefined): string {
  if (raw === "KEYWORD_ONLY") return "keyword-only"
  return "hybrid"
}

export async function searchVideos(
  query: string,
  limit = 20,
  offset = 0,
  type?: SearchContentType,
): Promise<{
  results: SearchResult[]
  hasMore: boolean
  query: string
  searchMode: string
  latencyMs: number
}> {
  const truncatedQuery = query.slice(0, MAX_QUERY_LENGTH)

  const startedAt = performance.now()
  const result = await client.query({
    query: SEARCH_QUERY,
    variables: {
      q: truncatedQuery,
      locale: "en",
      limit,
      offset,
      type: toAdminContentType(type),
    },
    fetchPolicy: "no-cache",
  })
  const latencyMs = performance.now() - startedAt

  if (result.error) {
    // Apollo's ErrorLike type is minimal but the runtime object may carry
    // graphQLErrors with extensions from the server response.
    const gqlErrors = (
      result.error as unknown as {
        graphQLErrors?: {
          message: string
          extensions?: Record<string, unknown>
        }[]
      }
    ).graphQLErrors

    if (gqlErrors?.length) {
      const firstError = gqlErrors[0]
      const code =
        (firstError.extensions?.code as string) ?? "UNKNOWN_SEARCH_ERROR"
      const message = firstError.message ?? "Search request failed"
      const retryAfterSeconds = firstError.extensions?.retryAfterSeconds as
        | number
        | undefined

      const searchError: SearchError = { code, message }
      if (retryAfterSeconds != null) {
        searchError.retryAfterSeconds = retryAfterSeconds
      }
      throw searchError
    }

    throw {
      code: "NETWORK_ERROR",
      message: result.error.message || "Search request failed",
    } satisfies SearchError
  }

  const data = result.data?.search
  const rawResults = data?.results ?? []
  const results: SearchResult[] = rawResults.map((row) => ({
    type: normalizeResultType(row.type),
    id: row.id,
    slug: row.slug,
    title: row.title,
    snippet: row.snippet,
    imageUrl: row.imageUrl ?? null,
    startSeconds: row.startSeconds ?? null,
    playbackId: row.playbackId ?? null,
    score: row.score,
  }))

  return {
    results,
    hasMore: data?.hasMore ?? false,
    query: data?.query ?? truncatedQuery,
    searchMode: normalizeSearchMode(data?.searchMode),
    latencyMs,
  }
}
