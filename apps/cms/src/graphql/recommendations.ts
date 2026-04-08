import type { Core } from "@strapi/strapi"
import {
  getRecommendations,
  VideoNotFoundError,
} from "../api/scene-embedding/services/recommender"

/**
 * GraphQL extension for scene recommendations.
 *
 * Registers a custom `sceneRecommendations` query using Strapi v5's
 * extensionService.use() pattern. The resolver calls the same
 * recommender service used by the REST endpoint.
 */
export function registerRecommendationsExtension(strapi: Core.Strapi) {
  const extensionService = strapi.plugin("graphql").service("extension")

  extensionService.use(() => ({
    typeDefs: `
      type SceneRecommendation {
        videoId: Int!
        sceneIndex: Int!
        description: String!
        startSeconds: Float!
        endSeconds: Float
        similarity: Float!
        themes: [String!]!
        playbackId: String!
      }

      type Query {
        sceneRecommendations(
          videoId: Int!
          locale: String!
          sceneIndex: Int
          limit: Int
        ): [SceneRecommendation!]!
      }
    `,
    resolvers: {
      Query: {
        sceneRecommendations: {
          resolve: async (
            _parent: unknown,
            args: {
              videoId: number
              locale: string
              sceneIndex?: number
              limit?: number
            },
          ) => {
            const { videoId, locale, sceneIndex, limit } = args
            try {
              return await getRecommendations(strapi, {
                videoId,
                locale,
                sceneIndex,
                limit,
              })
            } catch (err) {
              if (err instanceof VideoNotFoundError) {
                // No embeddings for this video — return empty results
                return []
              }
              strapi.log.error(
                `[scene-embedding] GraphQL recommendations failed: ${err instanceof Error ? err.message : String(err)}`,
              )
              throw new Error("Scene embedding features not available")
            }
          },
        },
      },
    },
    // Public access (same as Strapi shadowCRUD queries) — frontend clients
    // consume via GraphQL. The REST endpoint uses api-token-auth for internal
    // pipeline consumers. See routes/scene-embedding.ts for the REST auth config.
    resolversConfig: {
      "Query.sceneRecommendations": {
        auth: false,
      },
    },
  }))
}
