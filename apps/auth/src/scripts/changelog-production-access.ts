import { prisma } from "@/db/client"
import {
  ChangelogProductionAccessError,
  operateChangelogProductionAccess,
} from "@/services/changelog-production-access.service"

// A closed output pipe must not turn an already committed grant into a failure.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") throw error
})

async function main() {
  const [operation, ...extra] = process.argv.slice(2)
  if (
    (operation !== "inspect" &&
      operation !== "grant-admin" &&
      operation !== "revoke") ||
    extra.length
  ) {
    process.stderr.write(
      "Usage: pnpm --filter @forge/auth changelog:production-access <inspect|grant-admin|revoke>\n",
    )
    process.exitCode = 1
    return
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  try {
    const email = await prompt.question("Recipient email: ")
    const result = await operateChangelogProductionAccess(operation, email)
    try {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    } catch {
      // The operation has committed; inspect can recover the result.
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof ChangelogProductionAccessError ? error.message : "Production access operation failed. Verify the Auth database connection and retry inspect."}\n`,
    )
    process.exitCode = 1
  } finally {
    prompt.close()
    await prisma.$disconnect()
  }
}

main().catch(() => {
  process.stderr.write(
    "Could not complete the Auth operator command. Run inspect to check the grant state.\n",
  )
  process.exitCode = 1
})
import { createInterface } from "node:readline/promises"
