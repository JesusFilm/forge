import { syncPrisma } from "@/db/client"
import { runSync } from "@/services/core-sync/orchestrator"

function parseArgs(argv: string[]) {
  const full = argv.includes("--full")
  const scopeArg = argv.find((arg) => arg.startsWith("--scope="))
  const scope = scopeArg
    ? scopeArg
        .slice("--scope=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined

  return {
    incremental: !full,
    scope,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const startedAt = Date.now()
  const result = await runSync(syncPrisma, options)

  console.log(
    JSON.stringify(
      {
        ...result,
        wallClockMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await syncPrisma.$disconnect()
  })
