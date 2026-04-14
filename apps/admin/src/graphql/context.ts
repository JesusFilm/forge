// Per-request GraphQL context builder.
//
// Unit 5 resolves the Better Auth session from request cookies, then maps
// the DB-backed user role into the GraphQL principal. `SYSTEM` remains an
// in-process-only principal; HTTP requests can never mint it.
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { prisma } from "@/db/client"
import { resolvePrincipalFromRequest } from "@/auth/session"
import type { ContextShape } from "@/graphql/builder"
import { createLoaders } from "@/graphql/loaders"
import { createServices } from "@/services"

export async function createContext({
  request,
}: {
  request: Request
}): Promise<ContextShape> {
  const user = await resolvePrincipalFromRequest(request)
  return {
    user,
    request,
    prisma,
    loaders: createLoaders(prisma),
    services: createServices(prisma),
  }
}
