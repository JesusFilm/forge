import type { Core } from "@strapi/strapi"
import { GraphQLError } from "graphql"
import { isDebugAllowedForOrigin } from "../api/search/services/debug-allowlist"
import {
  search,
  isContentType,
  type ContentType,
} from "../api/search/services/search"
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
 * Strapi's formatGraphqlError only propagates `extensions` for errors
 * that are already `GraphQLError` instances (or recognized Strapi error
 * classes). A plain `Error` subclass with `.extensions` attached gets
 * replaced with `{ code: "INTERNAL_SERVER_ERROR" }`, stripping our
 * machine-readable error codes. We throw `GraphQLError` directly so
 * agents can read `extensions.code` from the response envelope.
 */

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
      type SearchRetrieverRank {
        label: String!
        rank: Int!
      }

      type SearchResultDebug {
        "1-based rank of this result in each contributing retriever list."
        retrieverRanks: [SearchRetrieverRank!]!
        "RRF fused score before the keyword-first dilution cap was applied."
        fusedScore: Float!
        "True when the keyword-first dilution cap halved this result's score."
        dilutionCapApplied: Boolean!
      }

      type SearchResult {
        "Discriminator: 'video' or 'experience'."
        type: String!
        id: Int!
        slug: String!
        title: String!
        imageUrl: String
        snippet: String!
        "Null for experience results, and for keyword-only video matches that have no scene-level timestamp."
        startSeconds: Float
        "Null for experience results, and for keyword-only video matches that have no scene-level Mux asset."
        playbackId: String
        score: Float!
        "Internal scoring detail. Populated only when the request passed debug=true AND the origin is on the debug allowlist."
        debug: SearchResultDebug
      }

      type SearchResponse {
        results: [SearchResult!]!
        "True when more results exist beyond the current page."
        hasMore: Boolean!
        query: String!
        "Which retrieval paths contributed to this response: 'hybrid' (semantic + keyword) or 'keyword-only' (embedding service unavailable, degraded)."
        searchMode: String!
      }

      type Query {
        semanticSearch(
          query: String!
          locale: String!
          limit: Int
          offset: Int
          "Restrict results to a single content type ('video' or 'experience'). Omit to return both."
          type: String
          "Optional retrieval mode. 'hybrid' (default) preserves current behavior; 'keyword-first' opts into the lexical stack (feat-109). Distinct from the response 'searchMode' field, which is a degradation signal. Unknown values fall back to 'hybrid' with a structured warn log."
          mode: String
          "Surface internal scoring detail per result. Stripped at the boundary unless the request origin is on the debug allowlist."
          debug: Boolean
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
              type?: string
              mode?: string | null
              debug?: boolean | null
            },
            context: unknown,
          ) => {
            // Match REST controller: reject empty/whitespace queries rather
            // than passing them to OpenRouter (meaningless embedding) and SQL.
            if (args.query.trim().length === 0) {
              throw new GraphQLError("query must not be empty", {
                extensions: { code: "BAD_USER_INPUT" },
              })
            }

            // Validate optional type filter at the GraphQL boundary so
            // invalid values fail fast with a structured error code.
            let contentTypes: ContentType[] | undefined
            if (args.type != null && args.type.length > 0) {
              if (!isContentType(args.type)) {
                throw new GraphQLError("type must be 'video' or 'experience'", {
                  extensions: { code: "BAD_USER_INPUT" },
                })
              }
              contentTypes = [args.type]
            }

            // Share the SEARCH_RATE_LIMIT.key bucket with the REST middleware
            // so an attacker can't bypass the limit by alternating endpoints.
            const ip = getClientIpFromGraphQLContext(context)
            const rateLimit = checkRateLimit(
              `${SEARCH_RATE_LIMIT.key}:${ip}`,
              SEARCH_RATE_LIMIT.max,
              SEARCH_RATE_LIMIT.windowMs,
            )
            if (rateLimit.allowed === false) {
              strapi.log.warn(
                `[rate-limit] ${ip} exceeded limit on GraphQL semanticSearch`,
              )
              throw new GraphQLError(
                "Too many requests. Please try again later.",
                {
                  extensions: {
                    code: "RATE_LIMITED",
                    retryAfterSeconds: rateLimit.retryAfterSeconds,
                  },
                },
              )
            }

            // Optional retrieval mode (feat-109). Empty string treated
            // as omitted to mirror REST. Unknown values warn-and-fall-
            // back inside the service; never raised as a GraphQL error.
            const mode =
              args.mode != null && args.mode.length > 0 ? args.mode : undefined

            // Optional debug field (feat-109). Origin-gated at the
            // boundary — service trusts the boolean. Fail closed when
            // origin is undefined.
            const ctxAsKoa = context as
              | {
                  koaContext?: {
                    request?: { headers?: Record<string, string | undefined> }
                  }
                }
              | undefined
            const origin = ctxAsKoa?.koaContext?.request?.headers?.origin
            const debug = args.debug === true && isDebugAllowedForOrigin(origin)

            try {
              return await search(strapi, {
                query: args.query.trim(),
                locale: args.locale,
                limit: args.limit,
                offset: args.offset,
                contentTypes,
                mode,
                debug,
              })
            } catch (err) {
              strapi.log.error(
                `[search] GraphQL search failed: ${err instanceof Error ? err.message : String(err)}`,
              )
              throw new GraphQLError("Search is temporarily unavailable", {
                extensions: { code: "SERVICE_UNAVAILABLE" },
              })
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
