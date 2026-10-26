import { parseRetentionPhaseFailureLog } from "../src/services/recommendations/retention-phase-diagnostics"

// Bounds apply before JSON parsing, including to an unfinished provider line.
const MAX_LINE_BYTES = 16 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const MAX_LINES = 1000
const MAX_EVENTS = 100
const allowLegacyJson = process.argv.includes("--allow-legacy-json")

async function main(): Promise<void> {
  let totalBytes = 0
  let inspected = 0
  let validated = 0
  let oversized = 0
  let lineBytes = 0
  let lineParts: Buffer[] = []
  let discardLine = false
  let capReason: "none" | "total_bytes" | "lines" | "events" = "none"

  const completeLine = (): void => {
    inspected += 1
    if (discardLine) {
      oversized += 1
    } else {
      const line = Buffer.concat(lineParts, lineBytes).toString("utf8")
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
        // A plain log line is also accepted. Never echo malformed content.
      }
      const diagnostic =
        typeof message === "string"
          ? parseRetentionPhaseFailureLog(message, { allowLegacyJson })
          : null
      if (diagnostic !== null) {
        validated += 1
        process.stdout.write(`${JSON.stringify(diagnostic)}\n`)
      }
    }
    lineBytes = 0
    lineParts = []
    discardLine = false
    if (inspected >= MAX_LINES) capReason = "lines"
    if (validated >= MAX_EVENTS) capReason = "events"
  }

  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const remaining = MAX_TOTAL_BYTES - totalBytes
    const accepted = bytes.subarray(0, remaining)
    totalBytes += accepted.length
    let start = 0
    while (start < accepted.length) {
      const newline = accepted.indexOf(10, start)
      const end = newline < 0 ? accepted.length : newline
      const part = accepted.subarray(start, end)
      if (!discardLine) {
        if (lineBytes + part.length > MAX_LINE_BYTES) {
          discardLine = true
          lineParts = []
          lineBytes = 0
        } else {
          lineParts.push(Buffer.from(part))
          lineBytes += part.length
        }
      }
      if (newline < 0) break
      completeLine()
      if (capReason !== "none") break
      start = newline + 1
    }
    if (capReason !== "none") break
    if (accepted.length < bytes.length || totalBytes >= MAX_TOTAL_BYTES) {
      capReason = "total_bytes"
      break
    }
  }

  // An unterminated line might be truncated by the total-byte limit. Never
  // parse it, even when its prefix happens to be valid JSON.
  const unfinished = lineBytes > 0 || discardLine
  process.stderr.write(
    `inspected=${inspected} validated=${validated} oversized=${oversized} unfinished=${unfinished} capped=${capReason !== "none"} cap_reason=${capReason}\n`,
  )
}

void main()
