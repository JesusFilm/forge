/**
 * Public hybrid-search GraphQL query (`search`).
 *
 * Delegates to HybridSearchService — the same service the REST route at
 * /api/search calls. Matches cms's `/api/search` response shape so
 * consumers can choose REST or GraphQL interchangeably.
 *
 * @classification public-shape
 */

import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import {
  HybridSearchService,
  isContentType,
  type ContentType,
  type SearchResult,
  type SearchResponse,
} from "@/services/hybrid-search.service"
import { isDebugAllowedForOrigin } from "@/services/hybrid-search-debug-allowlist"
import { SearchResultDebugRef } from "@/graphql/types/hybrid-search-debug"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

const ContentTypeEnum = builder.enumType("HybridSearchContentType", {
  description: "Content corpus filter for hybrid search.",
  values: {
    VIDEO: { value: "video" },
    EXPERIENCE: { value: "experience" },
  } as const,
})

const SearchModeEnum = builder.enumType("HybridSearchMode", {
  description:
    "Which retrieval paths contributed to a response. 'keyword-only' indicates the query embedding call failed and only keyword search ran.",
  values: {
    HYBRID: { value: "hybrid" },
    KEYWORD_ONLY: { value: "keyword-only" },
  } as const,
})

const SearchResultRef = builder.objectRef<SearchResult>("HybridSearchResult")
SearchResultRef.implement({
  description:
    "A single hybrid-search hit. Video results may carry scene-level snippet + timecode + playback id; experience results carry experience-level data.",
  fields: (t) => ({
    type: t.field({
      type: ContentTypeEnum,
      nullable: false,
      resolve: (r) => r.type,
    }),
    id: t.exposeString("id", { nullable: false }),
    slug: t.exposeString("slug", { nullable: false }),
    title: t.exposeString("title", { nullable: false }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    snippet: t.exposeString("snippet", { nullable: false }),
    startSeconds: t.exposeFloat("startSeconds", { nullable: true }),
    playbackId: t.exposeString("playbackId", { nullable: true }),
    score: t.exposeFloat("score", { nullable: false }),
    debug: t.field({
      type: SearchResultDebugRef,
      nullable: true,
      description:
        "Internal scoring detail. Present only when the caller passed `debug: true` AND the request origin is on the debug allowlist. Origin-gating happens at the resolver boundary; the service trusts the boolean.",
      resolve: (r) => r.debug ?? null,
    }),
  }),
})

const SearchResponseRef = builder.objectRef<SearchResponse>(
  "HybridSearchResponse",
)
SearchResponseRef.implement({
  description:
    "Full response envelope. `hasMore` is derived without a COUNT pass by dedup-to-(offset+limit+1). `searchMode` is the degradation signal.",
  fields: (t) => ({
    results: t.field({
      type: [SearchResultRef],
      nullable: false,
      resolve: (r) => r.results,
    }),
    hasMore: t.exposeBoolean("hasMore", { nullable: false }),
    query: t.exposeString("query", { nullable: false }),
    searchMode: t.field({
      type: SearchModeEnum,
      nullable: false,
      description:
        "Embedding-degradation signal — 'hybrid' when semantic retrieval ran, 'keyword-only' when the embedding provider failed. ORTHOGONAL to the input arg `mode`, which selects the retrieval pipeline. Same name, different concern.",
      resolve: (r) => r.searchMode,
    }),
  }),
})

// -----------------------------------------------------------------------------
// Query field
// -----------------------------------------------------------------------------

builder.queryFields((t) => ({
  search: t.field({
    type: SearchResponseRef,
    authScopes: { public: true },
    description:
      "Hybrid (semantic + keyword) search across videos and experiences. PUBLIC — see published + non-archived rows only.",
    args: {
      q: t.arg.string({ required: true }),
      locale: t.arg.string({ required: true }),
      type: t.arg({ type: ContentTypeEnum, required: false }),
      limit: t.arg.int({ required: false }),
      offset: t.arg.int({ required: false }),
      mode: t.arg.string({
        required: false,
        description:
          "Selects the retrieval pipeline. Default: 'hybrid' (the R4 baseline). Currently accepts 'hybrid' and 'keyword-first'. Unknown values fall back to 'hybrid' with a server-side warn log; never throws. Kept as a nullable String (not an enum) so future modes ship without GraphQL schema changes. ORTHOGONAL to the response field `searchMode`, which reports the embedding-degradation signal ('hybrid' | 'keyword-only') based on whether semantic retrieval ran — these two share a name but answer different questions.",
      }),
      debug: t.arg.boolean({
        required: false,
        description:
          "When true, attaches internal scoring detail under `result.debug` (per-retriever ranks, fused score, dilution-cap state). Origin-gated at the resolver: requests from non-allowlisted origins (production browsers) silently get the payload stripped. Treat this as a soft feature flag — Origin headers are NOT an authentication mechanism.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      const query = args.q.trim()
      if (query.length === 0) {
        throw new Error("q (search query) is required")
      }
      // Length cap mirrors the REST handler (`MAX_QUERY_LENGTH = 1024`).
      // Bounds the input that flows into `websearch_to_tsquery`,
      // `similarity()`, and the embedding provider — the per-token
      // `MAX_EXACT_TITLE_TOKENS = 16` cap inside `searchByExactTitle`
      // covers a different scenario.
      if (query.length > 1024) {
        throw new Error("q must be at most 1024 characters")
      }
      if (!args.locale || args.locale.length === 0) {
        throw new Error("locale is required")
      }

      let contentTypes: ContentType[] | undefined
      if (args.type != null) {
        const raw = String(args.type)
        if (!isContentType(raw)) {
          throw new Error("type must be 'video' or 'experience'")
        }
        contentTypes = [raw]
      }

      // `mode` stays a free-form string at the boundary; the service's
      // `normalizeMode` warn-and-falls-back on unknown values. Empty
      // string is forwarded as undefined so an explicit `mode: ""` from
      // a client doesn't pollute the warn log.
      const rawMode = args.mode ?? undefined
      const mode = rawMode != null && rawMode.length > 0 ? rawMode : undefined

      // `debug` is origin-gated. Yoga sets `Origin` from the underlying
      // Request; if absent (server-to-server, curl) the gate fails
      // closed. The service trusts the boolean — this is the only
      // place that consults the allowlist.
      const debugRequested = args.debug === true
      // ContextShape.request is non-nullable Request; same for Headers.
      const origin = ctx.request.headers.get("origin") ?? undefined
      const debug = debugRequested && isDebugAllowedForOrigin(origin)

      const service = new HybridSearchService({ prisma })
      return service.search({
        query,
        locale: args.locale,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
        contentTypes,
        mode,
        debug,
      })
    },
  }),
}))
