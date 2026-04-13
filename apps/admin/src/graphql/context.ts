// Per-request GraphQL context builder.
//
// Unit 3 spike: extracts a principal from an `x-spike-role` header
// (throwaway auth). Unit 5 replaces this with real Better Auth session
// resolution + Firebase fallback; Unit 6 extends context with services
// and DataLoader instances.
//
// Default posture is PUBLIC (null user). Resolvers enforce their own auth
// via scope-auth; the context itself never grants privilege.
//
// Per Unit 3 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { prisma } from "@/db/client"
import type { ContextShape, Role } from "@/graphql/builder"
import { createLoaders } from "@/graphql/loaders"

const SPIKE_ROLES: readonly Role[] = [
  "ADMIN",
  "EDITOR",
  "VIEWER",
  "SYSTEM",
] as const

function parseSpikeRole(header: string | null): Role | null {
  if (header === null) return null
  const trimmed = header.trim().toUpperCase()
  return (SPIKE_ROLES as readonly string[]).includes(trimmed)
    ? (trimmed as Role)
    : null
}

export async function createContext({
  request,
}: {
  request: Request
}): Promise<ContextShape> {
  const role = parseSpikeRole(request.headers.get("x-spike-role"))
  const user =
    role === null ? null : { id: `spike-${role.toLowerCase()}`, role }
  return { user, prisma, loaders: createLoaders(prisma) }
}
