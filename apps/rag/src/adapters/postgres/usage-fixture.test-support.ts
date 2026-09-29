import { PrismaClient } from "../../generated/prisma/index.js"
import { UsageError } from "../../contracts/consumer-usage.js"
import { PostgresUsageInventory } from "./usage-inventory.js"
export const usageTestDatabaseUrl =
  process.env.RAG_USAGE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
export async function resetUsageTestDatabase(
  deployment?: string,
): Promise<void> {
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
    if (deployment)
      await new PostgresUsageInventory(db).declare(
        deployment,
        new Date("2020-01-01T00:00:00Z"),
        1,
      )
  } finally {
    await db.$disconnect()
  }
}
