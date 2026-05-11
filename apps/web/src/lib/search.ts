import type { TypedDocumentNode } from "@apollo/client"
import { adminGraphql, type AdminResultOf } from "@forge/graphql"
import client from "@/lib/client"

const ADMIN_SEARCH_WITH_TYPE = adminGraphql(`
  query SemanticSearch(
    $query: String!
    $locale: String!
    $limit: Int
    $offset: Int
    $type: HybridSearchContentType
  ) {
    semanticSearch: search(
      q: $query
      locale: $locale
      limit: $limit
      offset: $offset
      type: $type
    ) {
      query
      hasMore
      searchMode
      results {
        type
        id
        slug
        title
        imageUrl
        snippet
        startSeconds
        playbackId
        score
      }
    }
  }
`)

type AdminSearchResponse = NonNullable<
  AdminResultOf<typeof ADMIN_SEARCH_WITH_TYPE>["semanticSearch"]
>

type AdminSearchResult = AdminSearchResponse["results"][number]

export type SearchResult = Omit<AdminSearchResult, "type"> & {
  type: SearchContentType | AdminSearchContentType
}

type SearchResponse = Omit<AdminSearchResponse, "results"> & {
  results: SearchResult[]
}

export const SEMANTIC_SEARCH =
  ADMIN_SEARCH_WITH_TYPE as unknown as TypedDocumentNode<
    { semanticSearch: SearchResponse | null },
    {
      query: string
      locale: string
      limit?: number | null
      offset?: number | null
      type?: SearchContentType | AdminSearchContentType | null
    }
  >

export type SearchError = {
  code: string
  message: string
  retryAfterSeconds?: number
}

const MAX_QUERY_LENGTH = 200

export type SearchContentType = "video" | "experience"

type AdminSearchContentType = "VIDEO" | "EXPERIENCE"

function toAdminSearchType(
  type: SearchContentType | undefined,
): AdminSearchContentType | undefined {
  if (type === "video") return "VIDEO"
  if (type === "experience") return "EXPERIENCE"
  return undefined
}

function toSearchResult(result: AdminSearchResult): SearchResult {
  return {
    ...result,
    type: result.type.toLowerCase() as SearchContentType,
  }
}

function toSearchMode(mode: AdminSearchResponse["searchMode"]): string {
  if (mode === "KEYWORD_ONLY") return "keyword-only"
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
    query: ADMIN_SEARCH_WITH_TYPE,
    variables: {
      query: truncatedQuery,
      locale: "en",
      limit,
      offset,
      type: toAdminSearchType(type),
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

  const data = result.data?.semanticSearch

  return {
    results: data?.results.map(toSearchResult) ?? [],
    hasMore: data?.hasMore ?? false,
    query: data?.query ?? truncatedQuery,
    searchMode: data ? toSearchMode(data.searchMode) : "hybrid",
    latencyMs,
  }
}
