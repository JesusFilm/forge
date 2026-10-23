async function writeAndFlush(
  stream: NodeJS.WriteStream,
  message: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    stream.write(message, (error) => (error ? reject(error) : resolve())),
  )
}

async function main(): Promise<number> {
  if (process.argv.length !== 3 || process.argv[2] !== "--expired-only") {
    await writeAndFlush(
      process.stderr,
      "Usage: pnpm retention:run-once --expired-only\n",
    )
    return 2
  }
  try {
    const { prisma } = await import("@/db/client")
    const {
      recommendationRetentionNeedsContinuation,
      runManualRecommendationRetentionOnce,
    } = await import("@/services/recommendations/retention/job")
    const { ledgerRunId, result } =
      await runManualRecommendationRetentionOnce().finally(() =>
        prisma.$disconnect(),
      )
    await writeAndFlush(
      process.stdout,
      `${JSON.stringify({
        ledgerRunId,
        status: result.status,
        rootsDeleted: result.rootsDeleted,
        rowCounts: result.rowCounts,
        batchLimitReached: result.batchLimitReached,
        overdueAfterRun: result.overdueAfterRun,
        oldestExpiredAtAfter: result.oldestExpiredAtAfter,
        continuationRequired: recommendationRetentionNeedsContinuation(result),
      })}\n`,
    )
    // A skipped or yielded pass can contain committed earlier phases, but an
    // operator must reconcile it before launching another pass.
    return result.status === "succeeded" ? 0 : 3
  } catch {
    await writeAndFlush(
      process.stderr,
      "Manual retention failed; inspect the durable ledgers before retrying.\n",
    )
    return 1
  }
}

// The one-shot CLI has no background work after Prisma disconnects. Workflow
// imports can retain process handles; exiting here keeps a completed operator
// command from appearing transport-uncertain after its durable ledger commits.
void main().then(
  (code) => process.exit(code),
  () => process.exit(1),
)
