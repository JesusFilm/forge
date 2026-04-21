import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"

export const SEMANTIC_SEARCH = graphql(`
  query SemanticSearch(
    $query: String!
    $locale: String!
    $limit: Int
    $offset: Int
  ) {
    semanticSearch(
      query: $query
      locale: $locale
      limit: $limit
      offset: $offset
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

export type SearchResult = ResultOf<
  typeof SEMANTIC_SEARCH
>["semanticSearch"]["results"][number]

type SearchResponse = ResultOf<typeof SEMANTIC_SEARCH>["semanticSearch"]

export type SearchError = {
  code: string
  message: string
  retryAfterSeconds?: number
}

const MAX_QUERY_LENGTH = 200

export async function searchVideos(
  query: string,
  limit = 20,
  offset = 0,
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
    query: SEMANTIC_SEARCH,
    variables: {
      query: truncatedQuery,
      locale: "en",
      limit,
      offset,
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

  const data = result.data?.semanticSearch as SearchResponse | undefined

  return {
    results: data?.results ?? [],
    hasMore: data?.hasMore ?? false,
    query: data?.query ?? truncatedQuery,
    searchMode: data?.searchMode ?? "hybrid",
    latencyMs,
  }
}
