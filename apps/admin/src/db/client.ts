// Prisma client singletons.
//
// Two clients are exported:
//   - `prisma`       — the main client for GraphQL + mutations
//                      (max=10, connection timeout=20s via PrismaPg adapter)
//   - `syncPrisma`   — dedicated client for Core sync background workflow
//                      (max=5, connection timeout=60s via PrismaPg adapter)
//                      so sync cannot starve read traffic.
//
// Both use the Next.js HMR-safe singleton pattern: dev reloads reuse the
// existing client from `globalThis` instead of spawning new pools.
//
// Per Unit 2 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { PrismaPg } from "@prisma/adapter-pg"
import { Prisma, PrismaClient } from "@prisma/client"
import {
  prismaPgAdapterConfigForProfile,
  type PrismaPoolProfile,
} from "@/db/prisma-pool-config"

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
  profile: PrismaPoolProfile,
  options?: Omit<Prisma.PrismaClientOptions, "adapter" | "datasourceUrl">,
): PrismaClient {
  const adapterConfig = prismaPgAdapterConfigForProfile(
    process.env.DATABASE_URL,
    profile,
  )
  const adapter = new PrismaPg(adapterConfig.poolConfig, adapterConfig.options)

  return new PrismaClient({ ...options, adapter }).$extends(
    embeddingGuardExtension,
  ) as unknown as PrismaClient
}

/**
 * Main Prisma client. Use for GraphQL resolvers, services, and user-facing
 * mutations. Pool tuning lives in the PrismaPg adapter config above so
 * `DATABASE_URL` remains a plain Postgres URL usable by libpq tools.
 */
export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient("main", {
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  })

/**
 * Dedicated Prisma client for Core sync background workflow. Production should
 * use the same `DATABASE_URL` with its own adapter pool sized against total
 * Postgres capacity.
 */
export const syncPrisma =
  globalForPrisma.syncPrisma ??
  createPrismaClient("sync", {
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
  globalForPrisma.syncPrisma = syncPrisma
}
