import { PrismaClient } from "../../generated/prisma/index.js"
import { UsageError } from "../../contracts/consumer-usage.js"
export const usageTestDatabaseUrl =
  process.env.RAG_USAGE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
export async function resetUsageTestDatabase(): Promise<void> {
  if (!usageTestDatabaseUrl) return
  if (
    !["localhost", "127.0.0.1"].includes(new URL(usageTestDatabaseUrl).hostname)
  )
    throw new UsageError("unavailable")
  const db = new PrismaClient({ datasourceUrl: usageTestDatabaseUrl })
  try {
    await db.$executeRawUnsafe(
      "TRUNCATE usage_private.pending, usage_private.minutes, usage_private.gaps, usage_private.collectors, usage_private.denials, usage_private.deployment_inventory",
    )
  } finally {
    await db.$disconnect()
  }
}
