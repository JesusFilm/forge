// Prisma client singletons.
//
// Two clients are exported:
//   - `prisma`       — the main client for GraphQL + mutations
//                      (connection_limit=10, pool_timeout=20 via DATABASE_URL)
//   - `syncPrisma`   — dedicated client for Core sync background workflow
//                      (for production, start around connection_limit=5 and
//                      pool_timeout=60 via DATABASE_URL_SYNC) so sync cannot
//                      starve read traffic.
//
// Both use the Next.js HMR-safe singleton pattern: dev reloads reuse the
// existing client from `globalThis` instead of spawning new pools.
//
// Per Unit 2 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { Prisma, PrismaClient } from "@prisma/client"

export const INCLUDE_EMBEDDING_ARG = "__includeEmbedding" as const

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  syncPrisma?: PrismaClient
}

export function takeEmbeddingOptIn(args: unknown): {
  cleanedArgs: unknown
  includeEmbedding: boolean
} {
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    return { cleanedArgs: args, includeEmbedding: false }
  }

  const cleanedArgs = { ...(args as Record<string, unknown>) }
  const includeEmbedding = cleanedArgs[INCLUDE_EMBEDDING_ARG] === true
  delete cleanedArgs[INCLUDE_EMBEDDING_ARG]

  return {
    cleanedArgs,
    includeEmbedding,
  }
}

export function stripEmbeddingFromResult<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      stripEmbeddingFromResult(item)
    }
    return value
  }

  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>
    delete record.embedding
    for (const nested of Object.values(record)) {
      stripEmbeddingFromResult(nested)
    }
  }

  return value
}

const embeddingGuardExtension = Prisma.defineExtension((client) =>
  client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const { cleanedArgs, includeEmbedding } = takeEmbeddingOptIn(args)
          const result = await query(cleanedArgs as never)
          return includeEmbedding ? result : stripEmbeddingFromResult(result)
        },
      },
    },
  }),
)

function createPrismaClient(
  options?: Prisma.PrismaClientOptions,
): PrismaClient {
  return new PrismaClient(options).$extends(
    embeddingGuardExtension,
  ) as unknown as PrismaClient
}

/**
 * Main Prisma client. Use for GraphQL resolvers, services, and user-facing
 * mutations. Configure `DATABASE_URL` with `?connection_limit=10&pool_timeout=20`.
 */
export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  })

/**
 * Dedicated Prisma client for Core sync background workflow. Production should
 * use an isolated `DATABASE_URL_SYNC` pool sized against total Postgres
 * capacity; a conservative starting point is
 * `?connection_limit=5&pool_timeout=60`.
 */
export const syncPrisma =
  globalForPrisma.syncPrisma ??
  createPrismaClient({
    datasourceUrl: process.env.DATABASE_URL_SYNC ?? process.env.DATABASE_URL,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
  globalForPrisma.syncPrisma = syncPrisma
}
