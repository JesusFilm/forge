import type { Core } from "@strapi/strapi"
import { search } from "../api/search/services/search"
import {
  SEARCH_RATE_LIMIT,
  checkRateLimit,
  resolveClientIp,
} from "../lib/rate-limit-bucket"

type GraphQLResolverContext = {
  koaContext?: {
    request?: { headers?: Record<string, string | undefined> }
    ip?: string
  }
}

/**
 * Resolves the client IP from a GraphQL context. The Strapi GraphQL plugin
 * exposes the Koa context under `koaContext`. Falls back to "unknown" when
 * the context is unavailable (e.g., during server-side resolver composition).
 */
function getClientIpFromGraphQLContext(context: unknown): string {
  const ctx = context as GraphQLResolverContext | undefined
  const koa = ctx?.koaContext
  return resolveClientIp(koa?.request?.headers ?? {}, koa?.ip)
}

/**
 * Rate-limit error with machine-readable extensions so GraphQL clients
 * (and agents) can programmatically detect rate-limiting and read the
 * retry window. Strapi's GraphQL plugin forwards `extensions` into the
 * standard `errors[].extensions` GraphQL response envelope.
 */
class RateLimitError extends Error {
  extensions: { code: "RATE_LIMITED"; retryAfterSeconds: number }
  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please try again later.")
    this.name = "RateLimitError"
    this.extensions = { code: "RATE_LIMITED", retryAfterSeconds }
  }
}

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
        "Null when the match is keyword-only (no scene-level timestamp)."
        startSeconds: Float
        "Null when the match is keyword-only (no scene-level Mux asset)."
        playbackId: String
        score: Float!
      }

      type SearchResponse {
        results: [SearchResult!]!
        "True when more results exist beyond the current page."
        hasMore: Boolean!
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
            context: unknown,
          ) => {
            // Match REST controller: reject empty/whitespace queries rather
            // than passing them to OpenRouter (meaningless embedding) and SQL.
            if (args.query.trim().length === 0) {
              throw new Error("query must not be empty")
            }

            // Share the SEARCH_RATE_LIMIT.key bucket with the REST middleware
            // so an attacker can't bypass the limit by alternating endpoints.
            const ip = getClientIpFromGraphQLContext(context)
            const rateLimit = checkRateLimit(
              `${SEARCH_RATE_LIMIT.key}:${ip}`,
              SEARCH_RATE_LIMIT.max,
              SEARCH_RATE_LIMIT.windowMs,
            )
            // Explicit === false narrows the discriminated union so TypeScript
            // allows .retryAfterSeconds access in the false branch.
            if (rateLimit.allowed === false) {
              strapi.log.warn(
                `[rate-limit] ${ip} exceeded limit on GraphQL semanticSearch`,
              )
              throw new RateLimitError(rateLimit.retryAfterSeconds)
            }

            try {
              return await search(strapi, {
                query: args.query.trim(),
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
