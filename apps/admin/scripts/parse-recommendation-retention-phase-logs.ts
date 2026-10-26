import { createInterface } from "node:readline"
import { parseRetentionPhaseFailureLog } from "../src/services/recommendations/retention-phase-diagnostics"

// Pipe bounded Railway --json deployment logs to this command. Output contains
// only validated, code-owned diagnostics; never echo unrecognized log lines.
const allowLegacyJson = process.argv.includes("--allow-legacy-json")
async function main(): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let inspected = 0
  let matched = 0
  for await (const line of lines) {
    if (++inspected > 1000) break
    let message: unknown = line
    try {
      const railwayLine: unknown = JSON.parse(line)
      if (
        railwayLine !== null &&
        typeof railwayLine === "object" &&
        "message" in railwayLine
      ) {
        message = railwayLine.message
      }
    } catch {
      // A plain log line is also accepted, without echoing malformed content.
    }
    const diagnostic =
      typeof message === "string"
        ? parseRetentionPhaseFailureLog(message, { allowLegacyJson })
        : null
    if (diagnostic === null) continue
    if (++matched > 100) break
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`)
  }
  process.stderr.write(
    `inspected=${Math.min(inspected, 1000)} validated=${Math.min(matched, 100)} capped=${inspected > 1000 || matched > 100}\n`,
  )
}

void main()
