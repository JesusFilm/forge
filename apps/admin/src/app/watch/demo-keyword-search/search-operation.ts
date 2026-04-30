/**
 * Hand-written GraphQL operation + response types for the
 * /watch/demo-keyword-search canary tool.
 *
 * Keeps the demo route-local rather than introducing a codegen
 * pipeline against admin's own GraphQL schema. If a second admin
 * frontend surface adopts GraphQL, promote to src/lib + add
 * gql.tada.
 */

export const SEARCH_OPERATION = /* GraphQL */ `
  query DemoKeywordSearch(
    $q: String!
    $locale: String!
    $limit: Int
    $mode: String
    $debug: Boolean
  ) {
    search(q: $q, locale: $locale, limit: $limit, mode: $mode, debug: $debug) {
      hasMore
      query
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
        debug {
          fusedScore
          dilutionCapApplied
          retrieverRanks {
            label
            rank
          }
        }
      }
    }
  }
`

export type SearchMode = "HYBRID" | "KEYWORD_ONLY"

export type ContentType = "VIDEO" | "EXPERIENCE"

export type SearchResultDebug = {
  fusedScore: number
  dilutionCapApplied: boolean
  retrieverRanks: Array<{ label: string; rank: number }>
}

export type SearchResult = {
  type: ContentType
  id: string
  slug: string
  title: string
  imageUrl: string | null
  snippet: string
  startSeconds: number | null
  playbackId: string | null
  score: number
  debug: SearchResultDebug | null
}

export type SearchResponse = {
  hasMore: boolean
  query: string
  searchMode: SearchMode
  results: SearchResult[]
}

export type DemoSearchData = {
  search: SearchResponse
}
