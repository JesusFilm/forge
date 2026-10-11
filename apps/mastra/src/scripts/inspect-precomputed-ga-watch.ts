import { env } from "../config/env"
import { createGaWatchHistoryReader } from "../services/precomputed-recommendations/ga-watch-history"

class GaWatchInspectConfigurationError extends Error {
  readonly code = "invalid_configuration"
}

function option(name: string): string | undefined {
  const matches = process.argv
    .slice(2)
    .filter((arg) => arg.startsWith(`--${name}=`))
  return matches.length === 1 ? matches[0]!.slice(name.length + 3) : undefined
}

async function main() {
  const propertyId = env.PRECOMPUTED_GA4_PROPERTY_ID
  const serviceAccountEmail = env.PRECOMPUTED_GA4_SERVICE_ACCOUNT_EMAIL
  const rangeStart = option("start")
  const rangeEnd = option("end")
  const mode = option("mode") ?? "coverage"
  if (
    !propertyId ||
    !serviceAccountEmail ||
    !rangeStart ||
    !rangeEnd ||
    !["coverage", "starts"].includes(mode)
  )
    throw new GaWatchInspectConfigurationError("invalid_configuration")
  const source = { propertyId, serviceAccountEmail, rangeStart, rangeEnd }
  const reader = createGaWatchHistoryReader(source)
  if (mode === "starts") {
    const offset = Number(option("offset") ?? "0")
    const page = await reader.readWatchStartsPage({ offset, limit: 100 })
    process.stdout.write(`${JSON.stringify(page)}\n`)
  } else {
    const coverage = await reader.inspectCoverage()
    process.stdout.write(`${JSON.stringify(coverage)}\n`)
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "invalid_configuration"
  process.stderr.write(`GA Watch preflight failed: ${code}\n`)
  process.exitCode = 1
})
