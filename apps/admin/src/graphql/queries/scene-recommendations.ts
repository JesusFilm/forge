/**
 * Public transcript-backed recommendations GraphQL query
 * (`sceneRecommendations`).
 *
 * Delegates to SceneRecommendationsService — the same service the REST
 * route at /api/scene-embedding/recommendations calls. Matches cms's
 * `sceneRecommendations` SDL shape field-for-field, modulo the
 * `videoId: Int!` → `videoId: ID!` identity delta (admin cuid strings
 * vs. cms integer ids). The field name stays for client parity, but
 * feat-192 backs it with enriched transcript chunks.
 *
 * `VideoNotFoundError` is soft-swallowed to `[]` (matches cms's
 * resolver) so the recommendations block on apps/web renders an empty
 * state rather than surfacing a top-level GraphQL error.
 *
 * @classification public-shape
 */

import { builder } from "@/graphql/builder"
import { prisma } from "@/db/client"
import {
  SceneRecommendationsService,
  VideoNotFoundError,
  type SceneRecommendation,
} from "@/services/scene-recommendations.service"

// -----------------------------------------------------------------------------
// Type
// -----------------------------------------------------------------------------

const SceneRecommendationRef = builder.objectRef<SceneRecommendation>(
  "SceneRecommendation",
)

SceneRecommendationRef.implement({
  description:
    "A single transcript-backed recommendation. Matches cms's SceneRecommendation shape modulo the cuid-string videoId.",
  fields: (t) => ({
    videoId: t.id({
      nullable: false,
      resolve: (r) => r.videoId,
    }),
    videoSlug: t.exposeString("videoSlug", { nullable: false }),
    videoTitle: t.exposeString("videoTitle", { nullable: false }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    sceneIndex: t.exposeInt("sceneIndex", { nullable: false }),
    description: t.exposeString("description", { nullable: false }),
    startSeconds: t.exposeFloat("startSeconds", { nullable: false }),
    endSeconds: t.exposeFloat("endSeconds", { nullable: true }),
    similarity: t.exposeFloat("similarity", { nullable: false }),
    themes: t.exposeStringList("themes", { nullable: false }),
    demographics: t.exposeStringList("demographics", { nullable: false }),
    spiritualContext: t.exposeStringList("spiritualContext", {
      nullable: false,
    }),
    playbackId: t.exposeString("playbackId", { nullable: false }),
  }),
})

// -----------------------------------------------------------------------------
// Query field
// -----------------------------------------------------------------------------

builder.queryFields((t) => ({
  sceneRecommendations: t.field({
    type: [SceneRecommendationRef],
    nullable: false,
    authScopes: { public: true },
    description:
      "Transcript-backed cosine-similarity recommendations. PUBLIC — see published, non-deleted rows only. Either videoId or slug must be supplied.",
    args: {
      videoId: t.arg.id({ required: false }),
      slug: t.arg.string({ required: false }),
      locale: t.arg.string({ required: true }),
      sceneIndex: t.arg.int({ required: false }),
      limit: t.arg.int({ required: false }),
    },
    resolve: async (_root, args, _ctx) => {
      // Single source of truth: validation + slug/videoId normalization
      // lives in SceneRecommendationsService.getRecommendations.
      const service = new SceneRecommendationsService({ prisma })
      try {
        return await service.getRecommendations({
          videoId: args.videoId != null ? String(args.videoId) : undefined,
          slug: args.slug ?? undefined,
          locale: args.locale,
          sceneIndex: args.sceneIndex ?? undefined,
          limit: args.limit ?? undefined,
        })
      } catch (error) {
        if (error instanceof VideoNotFoundError) {
          // Soft-swallow — matches cms's GraphQL resolver so the block
          // renders empty state rather than a top-level error.
          return []
        }
        // Structured-log format matching R4's search convention.
        console.error(
          `[scene-recommendations] event=graphql_query_failure ` +
            `error_class=${error instanceof Error ? error.constructor.name : "unknown"} ` +
            `message=${error instanceof Error ? error.message : String(error)}`,
        )
        throw new Error("Scene recommendation features not available")
      }
    },
  }),
}))
