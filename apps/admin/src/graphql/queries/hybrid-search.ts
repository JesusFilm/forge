/**
 * Public hybrid-search GraphQL query (`search`).
 *
 * Delegates to HybridSearchService — the same service the REST route at
 * /api/search calls. Matches cms's `/api/search` response shape so
 * consumers can choose REST or GraphQL interchangeably.
 *
 * @classification public-shape
 */

import { GraphQLError } from "graphql"

import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import { isAnyKnownBearer } from "@/auth/search-bearer"
import { env } from "@/config/env"
import {
  formatSearchTimingLogLine,
  HybridSearchService,
  isContentType,
  type ContentType,
  type SearchResult,
  type SearchResponse,
} from "@/services/hybrid-search.service"
import { isDebugAllowedForOrigin } from "@/services/hybrid-search-debug-allowlist"
import { recordSearchTraceSafely } from "@/services/search-trace.service"
import { SearchResultDebugRef } from "@/graphql/types/hybrid-search-debug"
import { VideoLabelEnum } from "@/graphql/types/video"

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
    "A single hybrid-search hit. Video results carry video-level display metadata plus optional match timecode/playback data; experience results carry experience-level data.",
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
    imageBlurDataUrl: t.exposeString("imageBlurDataUrl", {
      nullable: true,
      description:
        "Base64 blur data URL generated from the selected VideoImage. Null for experiences or video images without generated placeholder metadata yet.",
    }),
    muxThumbnailBlurDataUrl: t.exposeString("muxThumbnailBlurDataUrl", {
      nullable: true,
      description:
        "Base64 blur data URL for the Watch-card Mux thumbnail recipe. Null for experiences or when no playable Mux-backed dub is available.",
    }),
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
    // `SearchResult.label` is now typed as Prisma's `VideoLabel | null`
    // (see hybrid-search.service.ts), so `t.expose` reads it directly
    // without a resolver lambda. Using `t.expose` (rather than
    // `t.field`) also keeps `public-resolvers.regression.test.ts` from
    // false-positively flagging this object-type field as a root
    // resolver — its regex parser greps for `<name>: t.field(`.
    label: t.expose("label", {
      type: VideoLabelEnum,
      nullable: true,
      description:
        "Admin VideoLabel for video-type results (`EPISODE`, `SERIES`, `SHORT_FILM`, …). Always null for `type=EXPERIENCE`. Drives the type badge on the search result card.",
    }),
    durationSeconds: t.exposeInt("durationSeconds", {
      nullable: true,
      description:
        "Primary playable VideoDub duration in seconds, or null when the video has no playable dub (e.g., a SERIES/COLLECTION whose runtime lives on its children). Always null for `type=EXPERIENCE`. Drives the duration pill on singular-video cards.",
    }),
    childCount: t.exposeInt("childCount", {
      nullable: true,
      description:
        "Number of `video_relation` rows where this video is the parent. 0 for childless videos; null when `type=EXPERIENCE` or when the parent video was soft-deleted between the retriever pass and the hydration pass (rare race). Use `type` as the content-type discriminator — null on this field does NOT imply experience. Drives the `{n} episodes` pill on series/collection cards.",
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
      // Phase-1 dual-accept auth gate. After the SEARCH_AUTH_REQUIRED
      // flip, anonymous + invalid-bearer traffic throws and surfaces
      // as `errors[0].message` to the GraphQL client. The check
      // accepts ANY of three known-caller bearer sources (DB-backed
      // partner / consumer / workflow) — see `isAnyKnownBearer` — so
      // apps/web SSR + apps/mobile (carrying consumer-bearer for
      // graphql rate-limit identity) keep working without code
      // changes. External partners hold a DB-backed key issued via
      // `pnpm --filter @forge/admin partner-keys create`.
      //
      // The structured log tags every request with one of three
      // states (bearer / invalid_bearer / anonymous) so operators
      // can identify un-migrated callers BEFORE flipping the gate.
      // The check is request-level inside the resolver body (NOT a
      // scope-auth gate) so the same conditional `SEARCH_AUTH_REQUIRED`
      // flag governs both REST and GraphQL paths.
      //
      // GraphQL rate-limiting happens at the Yoga endpoint layer
      // (admin's existing /api/graphql limiter), not per-resolver,
      // so the REST sibling's "rate-limit before auth" ordering
      // doesn't apply here — every request to /api/graphql is
      // already rate-bucketed before the resolver runs.
      const authHeader = ctx.request.headers.get("authorization")
      const authResult = await isAnyKnownBearer(authHeader)
      const authTag: "bearer" | "invalid_bearer" | "anonymous" =
        authResult.valid
          ? "bearer"
          : authHeader != null
            ? "invalid_bearer"
            : "anonymous"
      // See route.ts for the rationale — on the current Next.js 16 +
      // Node 24 + Railway logsV2 + standalone stack, JSON-stringified
      // log payloads from runtime route handlers are silenced. Only
      // the `[label] event=name key=value` string format used by the
      // existing working logs in this surface reliably surfaces.
      //
      // `source=` distinguishes the matched bearer source; `keyId=`
      // is appended for PARTNER branches only (env-CSV branches don't
      // carry a per-key identifier). Stable positional fields
      // (`event`, `auth`, `path`) come first; optional fields appended
      // at the END so positional log-shipper rules stay stable.
      const sourceField = authResult.valid ? ` source=${authResult.source}` : ""
      const keyIdField =
        authResult.valid && authResult.keyId ? ` keyId=${authResult.keyId}` : ""
      console.error(
        `[search] event=search.request auth=${authTag} path=graphql${sourceField}${keyIdField}`,
      )
      if (!authResult.valid && env.SEARCH_AUTH_REQUIRED === "true") {
        // Typed GraphQLError with extensions.code so the auth signal
        // survives Yoga's default maskedErrors (which rewrites raw
        // `new Error(...)` to "Unexpected error." in production).
        // Clients branch on `errors[0].extensions.code === "UNAUTHENTICATED"`
        // — stable, schema-aligned, parallel to the REST 401 sibling.
        throw new GraphQLError("Authentication required", {
          extensions: {
            code: "UNAUTHENTICATED",
            http: { status: 401 },
          },
        })
      }

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
      const startedAt = new Date()
      try {
        const { response, trace, timings } = await service.searchWithTrace({
          query,
          locale: args.locale,
          limit: args.limit ?? undefined,
          offset: args.offset ?? undefined,
          contentTypes,
          mode,
          debug,
        })
        const traceWriteStartedAt = performance.now()
        await recordSearchTraceSafely({
          query,
          locale: args.locale,
          routeSource: "graphql",
          requestedMode: mode ?? null,
          searchMode: trace.searchMode,
          resultCount: trace.resultCount,
          outcome: trace.outcome,
          traceClass: trace.traceClass,
          startedAt,
          completedAt: new Date(),
        }).catch(() => {})
        const traceWriteMs = Math.max(
          0,
          Math.round((performance.now() - traceWriteStartedAt) * 10) / 10,
        )
        console.error(
          formatSearchTimingLogLine({
            route: "graphql",
            locale: args.locale,
            requestedMode: mode ?? null,
            searchMode: trace.searchMode,
            outcome: trace.outcome,
            resultCount: trace.resultCount,
            timings,
            traceWriteMs,
          }),
        )
        return response
      } catch (error) {
        await recordSearchTraceSafely({
          query,
          locale: args.locale,
          routeSource: "graphql",
          requestedMode: mode ?? null,
          searchMode: "failed",
          resultCount: 0,
          outcome: "failed",
          traceClass: "search_exception",
          startedAt,
          completedAt: new Date(),
        }).catch(() => {})
        throw error
      }
    },
  }),
}))
