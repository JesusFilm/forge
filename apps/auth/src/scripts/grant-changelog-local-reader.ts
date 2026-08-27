import { createInterface } from "node:readline/promises"

import { prisma } from "@/db/client"
import { grantChangelogLocalReader } from "@/services/changelog-local-reader-grant.service"

type CommandOptions = {
  argv?: readonly string[]
  readEmail?: () => Promise<string>
  writeOutput?: (message: string) => void
  writeError?: (message: string) => void
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function promptForEmail() {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    return await prompt.question("Recipient email: ")
  } finally {
    prompt.close()
  }
}

function redactEmail(email: string) {
  const [localPart, domain] = email.trim().toLowerCase().split("@")
  const suffixStart = domain.lastIndexOf(".")
  return `${localPart[0]}***@${domain[0]}***${domain.slice(suffixStart)}`
}

export async function runGrantChangelogLocalReaderCommand({
  argv = process.argv.slice(2),
  readEmail = promptForEmail,
  writeOutput = (message) => process.stdout.write(message),
  writeError = (message) => process.stderr.write(message),
}: CommandOptions = {}): Promise<number> {
  if (argv.length > 0) {
    writeError(
      "Usage: pnpm --filter @forge/auth changelog:grant-local-reader\n",
    )
    return 1
  }

  let email: string
  try {
    email = await readEmail()
    if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) {
      writeError(
        "Could not grant Local Changelog Reader access: enter a valid email address.\n",
      )
      return 1
    }
  } catch {
    writeError(
      "Could not grant Local Changelog Reader access. Verify the recipient and Auth environment, then retry.\n",
    )
    return 1
  }

  let result: { changed: boolean }
  try {
    result = await grantChangelogLocalReader(email)
  } catch {
    writeError(
      "Could not grant Local Changelog Reader access. Verify the recipient and Auth environment, then retry.\n",
    )
    return 1
  }

  const recipient = redactEmail(email)
  try {
    writeOutput(
      result.changed
        ? `Granted Local Changelog Reader access to ${recipient}.\n`
        : `No change: ${recipient} already has Local Changelog Reader-or-higher access.\n`,
    )
  } catch {
    // The grant is already committed. A closed output stream must not report it
    // as a failed authorization change.
  }
  return 0
}

if (process.argv[1]?.endsWith("grant-changelog-local-reader.ts")) {
  runGrantChangelogLocalReaderCommand()
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .finally(async () => {
      try {
        await prisma.$disconnect()
      } catch {
        process.stderr.write("Could not close the Auth database connection.\n")
        process.exitCode = 1
      }
    })
}
