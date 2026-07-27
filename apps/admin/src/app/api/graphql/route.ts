// Yoga handler mounted at /api/graphql.
//
// Security layers (Unit 9):
//   - GraphQL Armor: max-depth, max-aliases, max-tokens, cost-limit
//   - Introspection gated by GRAPHQL_INTROSPECTION_ENABLED (default off)
//   - CORS via env-driven CORS_ALLOWED_ORIGINS allowlist
//   - GraphiQL disabled in production
//
// Critical wiring note:
//   `fetchAPI: { Response }` is REQUIRED. Without it, Yoga returns its own
//   Response constructor and Next.js App Router streaming breaks.
//
// Rate limiting for the GraphQL endpoint lands as part of Unit 9's
// @envelop/rate-limiter integration (Redis-backed, operation-scope).
// Until then, Armor's cost-limit provides query-level cost protection.

import { createYoga } from "graphql-yoga"
import type { NextRequest } from "next/server"
import { schema } from "@/graphql/schema"
import { createContext } from "@/graphql/context"
import { armorPlugins } from "@/graphql/plugins/armor"
import { introspectionPlugins } from "@/graphql/plugins/introspection"
import { openTelemetryPlugin } from "@/graphql/plugins/opentelemetry"
import { rateLimitPlugin } from "@/graphql/plugins/rate-limit"
import { env } from "@/config/env"

type NextAppRouteContext = { params: Promise<Record<string, string>> }

const corsOrigins = env.CORS_ALLOWED_ORIGINS
  ? env.CORS_ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : []

// Fail closed: when no origins are configured, CORS is disabled entirely
// (no cross-origin requests allowed). Passing `origin: undefined` to Yoga
// would reflect the request Origin header, allowing any origin with
// credentials — a CSRF vector.
const corsConfig =
  corsOrigins.length > 0
    ? {
        origin: corsOrigins,
        credentials: true,
        methods: ["GET", "POST", "OPTIONS"],
      }
    : false

const yoga = createYoga<NextAppRouteContext>({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
  context: ({ request }) => createContext({ request }),
  plugins: [
    ...armorPlugins,
    ...introspectionPlugins,
    rateLimitPlugin,
    openTelemetryPlugin,
  ],
  graphiql: env.GRAPHQL_INTROSPECTION_ENABLED === "true",
  cors: corsConfig,
})

async function handler(
  request: NextRequest,
  context: NextAppRouteContext,
): Promise<Response> {
  return yoga.handle(request, context)
}

export { handler as GET, handler as POST, handler as OPTIONS }
