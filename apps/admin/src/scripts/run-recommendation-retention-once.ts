async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--expired-only") {
    console.error("Usage: pnpm retention:run-once --expired-only")
    process.exitCode = 2
    return
  }
  try {
    const { prisma } = await import("@/db/client")
    try {
      const { runManualRecommendationRetentionOnce } =
        await import("@/services/recommendations/retention/job")
      const { ledgerRunId, result } =
        await runManualRecommendationRetentionOnce()
      console.log(
        JSON.stringify({
          ledgerRunId,
          status: result.status,
          rootsDeleted: result.rootsDeleted,
          rowCounts: result.rowCounts,
          continuationRequired: result.continuationRequired ?? false,
        }),
      )
    } finally {
      await prisma.$disconnect()
    }
  } catch {
    console.error(
      "Manual retention failed; inspect the durable ledgers before retrying.",
    )
    process.exitCode = 1
  }
}

void main()
