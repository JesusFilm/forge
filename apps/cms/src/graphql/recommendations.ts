import type { Core } from "@strapi/strapi"
import { getRecommendations } from "../api/scene-embedding/services/recommender"

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
            return getRecommendations(strapi, {
              videoId,
              locale,
              sceneIndex,
              limit: limit ? Math.min(Math.max(1, limit), 50) : 10,
            })
          },
        },
      },
    },
    resolversConfig: {
      "Query.sceneRecommendations": {
        auth: false,
      },
    },
  }))
}
