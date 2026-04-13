// Yoga handler mounted at /api/graphql.
//
// Critical wiring notes:
//   - `fetchAPI: { Response }` is REQUIRED. Without it, Yoga returns its own
//     Response constructor and Next.js App Router streaming breaks.
//   - Unit 6 swaps `createContext` for session-aware context and Unit 9 adds
//     Armor/rate-limiter/CORS plugins to this module.
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { createYoga } from "graphql-yoga"
import type { NextRequest } from "next/server"
import { schema } from "@/graphql/schema"
import { createContext } from "@/graphql/context"

// Next's App Router signature: (req: NextRequest, ctx: { params: Promise<...> }).
// Yoga wants `{ request: Request }` in its context — wrap to bridge.
type NextAppRouteContext = { params: Promise<Record<string, string>> }

const yoga = createYoga<NextAppRouteContext>({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
  context: ({ request }) => createContext({ request }),
  // GraphiQL enabled in dev; Unit 9 gates this on GRAPHQL_INTROSPECTION_ENABLED.
  graphiql: process.env.NODE_ENV !== "production",
})

async function handler(
  request: NextRequest,
  context: NextAppRouteContext,
): Promise<Response> {
  return yoga.handle(request, context)
}

export { handler as GET, handler as POST, handler as OPTIONS }
