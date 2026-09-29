import { parseArgs } from "node:util"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { PostgresUsageStore } from "../src/adapters/postgres/consumer-usage.js"
import { UsageError } from "../src/contracts/consumer-usage.js"
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      instance: { type: "string" },
      "confirmed-stopped": { type: "boolean" },
    },
  })
  const url = process.env.RAG_USAGE_WRITER_DATABASE_URL
  if (
    !url ||
    !values["confirmed-stopped"] ||
    !/^[0-9a-f-]{36}$/i.test(values.instance ?? "")
  )
    throw new UsageError("unavailable")
  const db = new PrismaClient({ datasourceUrl: url })
  try {
    await new PostgresUsageStore(db).reconcile(values.instance!, new Date())
  } finally {
    await db.$disconnect()
  }
  console.log(
    "stopped collector reconciled; uncertainty remains a durable coverage gap",
  )
}
main().catch(() => {
  console.error("usage reconciliation refused or unavailable")
  process.exitCode = 1
})
