import { parseArgs } from "node:util"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { PostgresUsageInventory } from "../src/adapters/postgres/usage-inventory.js"
import { verifyUsageInventoryRole } from "./consumer-role-policy.js"
import { UsageError } from "../src/contracts/consumer-usage.js"
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      deployment: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      replicas: { type: "string" },
    },
  })
  const url = process.env.RAG_USAGE_INVENTORY_DATABASE_URL
  if (
    !url ||
    !values.deployment ||
    !!values.from === !!values.to ||
    (values.to && values.replicas)
  )
    throw new UsageError("unavailable")
  const db = new PrismaClient({ datasourceUrl: url })
  try {
    await verifyUsageInventoryRole(db)
    const inventory = new PostgresUsageInventory(db)
    if (values.from?.endsWith("Z"))
      await inventory.declare(
        values.deployment,
        new Date(values.from),
        Number(values.replicas),
      )
    else if (values.to?.endsWith("Z"))
      await inventory.close(values.deployment, new Date(values.to))
    else throw new UsageError("unavailable")
  } finally {
    await db.$disconnect()
  }
  console.log("independent deployment inventory updated")
}
main().catch(() => {
  console.error("usage inventory update refused or unavailable")
  process.exitCode = 1
})
