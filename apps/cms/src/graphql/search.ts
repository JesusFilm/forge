import type { Core } from "@strapi/strapi"
import { search } from "../api/search/services/search"

/**
 * GraphQL extension for semantic search.
 *
 * Registers a custom `semanticSearch` query using Strapi v5's
 * extensionService.use() pattern. The resolver calls the same
 * search service used by the REST endpoint.
 */
export function registerSearchExtension(strapi: Core.Strapi) {
  const extensionService = strapi.plugin("graphql").service("extension")

  extensionService.use(() => ({
    typeDefs: `
      type SearchResult {
        type: String!
        id: Int!
        slug: String!
        title: String!
        imageUrl: String
        snippet: String!
        startSeconds: Float!
        playbackId: String!
        score: Float!
      }

      type SearchResponse {
        results: [SearchResult!]!
        total: Int!
        query: String!
      }

      type Query {
        semanticSearch(
          query: String!
          locale: String!
          limit: Int
          offset: Int
        ): SearchResponse!
      }
    `,
    resolvers: {
      Query: {
        semanticSearch: {
          resolve: async (
            _parent: unknown,
            args: {
              query: string
              locale: string
              limit?: number
              offset?: number
            },
          ) => {
            try {
              return await search(strapi, {
                query: args.query,
                locale: args.locale,
                limit: args.limit,
                offset: args.offset,
              })
            } catch (err) {
              strapi.log.error(
                `[search] GraphQL search failed: ${err instanceof Error ? err.message : String(err)}`,
              )
              throw new Error("Search is temporarily unavailable")
            }
          },
        },
      },
    },
    resolversConfig: {
      "Query.semanticSearch": {
        auth: false,
      },
    },
  }))
}
