import { RetirementAdmissionError } from "../services/recommendations/behavioral-retirement-cleanup"

export function parseRetirementArguments(
  argv: string[],
): Record<string, string> {
  const parsed: Record<string, string> = {}
  const allowed = new Set([
    "operation-id",
    "release-a",
    "cutover-proof",
    "proof-sha256",
    "batch-size",
    "max-batches",
    "execute",
  ])
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)(?:=(.+))?$/.exec(arg)
    if (!match || !allowed.has(match[1]) || match[1] in parsed)
      throw new RetirementAdmissionError("Invalid retirement CLI argument")
    parsed[match[1]] = match[2] ?? "true"
  }
  if (
    parsed.execute !== "true" ||
    !parsed["operation-id"] ||
    !parsed["release-a"] ||
    !parsed["cutover-proof"] ||
    !parsed["proof-sha256"] ||
    !parsed["batch-size"] ||
    !parsed["max-batches"]
  )
    throw new RetirementAdmissionError(
      "Explicit source-bound execution acknowledgement required",
    )
  return parsed
}
