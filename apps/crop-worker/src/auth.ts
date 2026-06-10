import { timingSafeEqual } from "node:crypto"
import { env } from "./config/env.js"

export type BearerValidationOutcome = "ok" | "unauthorized" | "config_missing"

export type ValidateBearerOptions = {
  apiKeysCsv?: string | undefined
  nodeEnv?: string
}

function timingSafeStringEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)

  if (actualBytes.byteLength !== expectedBytes.byteLength) {
    // Compare against self to keep the comparison cost flat regardless of
    // whether lengths happen to match — without revealing key contents.
    timingSafeEqual(actualBytes, actualBytes)
    return false
  }

  return timingSafeEqual(actualBytes, expectedBytes)
}

export function parseApiKeysCsv(csv: string | undefined): string[] {
  if (!csv) return []
  return csv
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
}

export function validateBearer(
  authorizationHeader: string | string[] | undefined,
  {
    apiKeysCsv = env.CROP_WORKER_API_KEYS,
    nodeEnv = env.NODE_ENV,
  }: ValidateBearerOptions = {},
): BearerValidationOutcome {
  const allowlist = parseApiKeysCsv(apiKeysCsv)

  if (allowlist.length === 0) {
    return nodeEnv === "production" ? "config_missing" : "ok"
  }

  const header = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader
  if (!header) return "unauthorized"

  // Linear-time parse (no `\s+(.+)$`-style regex — an attacker-controlled
  // header of repeated whitespace makes that backtrack polynomially).
  const prefix = /^Bearer[ \t]+/.exec(header)
  if (!prefix) return "unauthorized"
  const presented = header.slice(prefix[0].length).trim()
  if (!presented) return "unauthorized"

  // Compare against the FULL allowlist without short-circuiting so timing
  // does not reveal which entry (if any) matched.
  let matched = false
  for (const key of allowlist) {
    if (timingSafeStringEqual(presented, key)) {
      matched = true
    }
  }

  return matched ? "ok" : "unauthorized"
}
