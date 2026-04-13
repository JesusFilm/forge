// Prisma client singletons.
//
// Two clients are exported:
//   - `prisma`       — the main client for GraphQL + mutations
//                      (connection_limit=10, pool_timeout=20 via DATABASE_URL)
//   - `syncPrisma`   — dedicated client for Core sync background workflow
//                      (connection_limit=2 via DATABASE_URL_SYNC) so sync
//                      cannot starve read traffic.
//
// Both use the Next.js HMR-safe singleton pattern: dev reloads reuse the
// existing client from `globalThis` instead of spawning new pools.
//
// Per Unit 2 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  syncPrisma?: PrismaClient
}

/**
 * Main Prisma client. Use for GraphQL resolvers, services, and user-facing
 * mutations. Configure `DATABASE_URL` with `?connection_limit=10&pool_timeout=20`.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  })

/**
 * Dedicated Prisma client for Core sync background workflow.
 * Isolated pool (`DATABASE_URL_SYNC` with `?connection_limit=2`) so a stalled
 * sync transaction cannot starve connections from the main pool.
 */
export const syncPrisma =
  globalForPrisma.syncPrisma ??
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL_SYNC ?? process.env.DATABASE_URL,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
  globalForPrisma.syncPrisma = syncPrisma
}
