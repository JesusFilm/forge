import { randomUUID } from "node:crypto"
import { prisma } from "@/db/client"
import { startExactCowatchShadowEvaluation } from "@/services/recommendations/shadow-evaluation/operator"

async function main() {
  if (!process.argv.includes("--execute")) {
    throw new Error(
      "Pass --execute to dispatch a bounded shadow-only evaluation",
    )
  }
  const now = new Date()
  const windowEnd = new Date(now.getTime() - 60_000)
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1_000)
  const result = await startExactCowatchShadowEvaluation(prisma, {
    evaluationId: randomUUID(),
    windowStart,
    windowEnd,
    requestedSampleSize: 100,
    minimumRuns: 30,
    actorId: "cowatch-shadow-cli",
    now,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

void main().finally(() => prisma.$disconnect())
