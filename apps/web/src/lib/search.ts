import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import { semanticSearchAdminClient } from "@/lib/admin-client"
import type { SearchLanguageResolution } from "./search-language"

// Admin's `search(q, locale, type, limit, offset, mode, debug)` is the
// hybrid (semantic + keyword) PUBLIC-tier search surface. Response shape
// keeps `hasMore`, `query`, `searchMode`, and a `results[]` array. Each
// `HybridSearchResult` carries the fields the web consumers already read
// (`id`, `title`, `snippet`, `imageUrl`, `slug`, `type`, `playbackId`,
// `startSeconds`, `score`) — admin's `type` is the upper-case
// `EXPERIENCE | VIDEO` enum, normalised to the lower-case discriminator
// the result-card components expect.
//
// DEPLOY ORDERING: this query selects `label`, `durationSeconds`, and
// `childCount` from `HybridSearchResult`. Those fields land in admin's
// resolver as part of the same branch as this query — but in a rolling
// deploy admin must ship FIRST (receiver-first invariant). Web ahead of
// admin yields `Cannot query field "label" on type "HybridSearchResult"`
// for every search until admin catches up. Same pattern as the bearer-
// keyring rotation documented at
// docs/solutions/architecture-patterns/consumer-bearer-rate-limit-identity-pattern-20260513.md

const WEB_SEARCH_MODE = "keyword-first"

const searchVideosOperation = adminGraphql(`
  query Search(
    $q: String!
    $locale: String!
    $limit: Int
    $offset: Int
    $type: HybridSearchContentType
    $mode: String
  ) {
    search(q: $q, locale: $locale, limit: $limit, offset: $offset, type: $type, mode: $mode) {
      hasMore
      query
      searchMode
      results {
        id
        slug
        title
        snippet
        imageUrl
        imageBlurDataUrl
        muxThumbnailBlurDataUrl
        playbackId
        startSeconds
        score
        type
        label
        durationSeconds
        childCount
      }
    }
  }
`)

export type SearchContentType = "video" | "experience"

// Derived from the gql.tada introspection of the actual search operation
// result. When admin adds a new VideoLabel value and the package
// regenerates `admin-graphql-env.d.ts`, this union widens automatically
// — no hand-mirrored string list to drift out of sync with the SDL.
export type AdminVideoLabel = NonNullable<
  NonNullable<
    AdminResultOf<typeof searchVideosOperation>["search"]
  >["results"][number]["label"]
>

export type SearchResult = {
  type: SearchContentType
  id: string
  slug: string
  title: string
  imageUrl: string | null
  imageBlurDataUrl: string | null
  muxThumbnailBlurDataUrl: string | null
  snippet: string
  startSeconds: number | null
  playbackId: string | null
  score: number
  /** Admin VideoLabel for video results; null when type === "experience". */
  label: AdminVideoLabel | null
  /** Primary playable dub duration in seconds; null for experiences and
   *  videos without a playable dub (e.g. a series whose runtime lives on
   *  its child episodes). Drives the duration pill on singular videos. */
  durationSeconds: number | null
  /** Count of child videos (parent_id === this video). null for
   *  experiences; 0 when a video has no children. Drives the
   *  "{n} episodes" pill on series / collection cards. */
  childCount: number | null
  /** Source adapter that produced this row. Omitted on legacy semantic rows. */
  source?: "semantic" | "algolia"
  /** Public Watch audio-language slug to prefer for result links. */
  languageSlug?: string | null
  /** Algolia/Core English language label, when the result came from a language-aware index. */
  languageEnglishName?: string | null
}

export type SearchError = {
  code: string
  message: string
  retryAfterSeconds?: number
}

export type SearchResponse = {
  results: SearchResult[]
  hasMore: boolean
  query: string
  searchMode: string
  latencyMs: number
  nextOffset?: number
}

export type SearchActionResultSource = "semantic" | "algolia"

export type SearchActionResult =
  | (SearchResponse & {
      ok: true
      resultSource: SearchActionResultSource
      resolvedLanguage: SearchLanguageResolution
      languageFacets?: Record<string, number>
    })
  | (Omit<SearchResponse, "results" | "hasMore"> & {
      ok: false
      results: []
      hasMore: false
      resultSource: SearchActionResultSource
      resolvedLanguage: SearchLanguageResolution
      languageFacets?: Record<string, number>
      error: SearchError
    })

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
  locale = "en",
): Promise<SearchResponse> {
  const truncatedQuery = query.slice(0, MAX_QUERY_LENGTH)

  const startedAt = performance.now()
  const result = await semanticSearchAdminClient.query({
    query: searchVideosOperation,
    variables: {
      q: truncatedQuery,
      locale,
      limit,
      offset,
      type: toAdminContentType(type),
      mode: WEB_SEARCH_MODE,
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
    imageBlurDataUrl: row.imageBlurDataUrl ?? null,
    muxThumbnailBlurDataUrl: row.muxThumbnailBlurDataUrl ?? null,
    startSeconds: row.startSeconds ?? null,
    playbackId: row.playbackId ?? null,
    score: row.score,
    label: row.label ?? null,
    durationSeconds: row.durationSeconds ?? null,
    childCount: row.childCount ?? null,
    source: "semantic",
  }))

  return {
    results,
    hasMore: data?.hasMore ?? false,
    query: data?.query ?? truncatedQuery,
    searchMode: normalizeSearchMode(data?.searchMode),
    latencyMs,
    nextOffset: offset + results.length,
  }
}
