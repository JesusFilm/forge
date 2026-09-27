import { prisma } from "@/db/client"
import { publishCowatchShadowGeneration } from "@/services/recommendations/cowatch/projection.service"

async function main() {
  if (!process.argv.includes("--execute")) {
    throw new Error(
      "Pass --execute to publish a shadow-only co-watch generation",
    )
  }
  const result = await publishCowatchShadowGeneration(prisma)
  // Aggregate-only output. Never log session, profile or outcome identifiers.
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result.status === "source_overflow" || result.status === "work_overflow")
    process.exitCode = 2
}

void main().finally(() => prisma.$disconnect())
