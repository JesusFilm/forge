import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

const EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/
const TOKEN = /^v1\.([A-Za-z0-9_-]{1,800})\.([A-Za-z0-9_-]{43})$/
const RETENTION_MS = 29 * 86_400_000

function signature(secret: string, payload: string) {
  return createHmac("sha256", secret)
    .update(`watch-experiment-measurement-v1\0${payload}`)
    .digest("base64url")
}

/** An integrity label for aggregate telemetry, never an authorization grant. */
export function issueWatchExperimentMeasurementTicket(
  secret: string | undefined,
  binding: { experimentId: string; requestId: string },
  now = new Date(),
): string | null {
  if (
    !secret ||
    secret.length < 32 ||
    !EXPERIMENT_ID.test(binding.experimentId) ||
    binding.requestId.length < 1 ||
    binding.requestId.length > 191 ||
    !Number.isFinite(now.getTime())
  )
    return null
  const payload = Buffer.from(
    JSON.stringify({
      e: binding.experimentId,
      r: binding.requestId,
      t: now.getTime(),
    }),
  ).toString("base64url")
  return `v1.${payload}.${signature(secret, payload)}`
}

export function readWatchExperimentMeasurementTicket(
  secret: string | undefined,
  token: string | null | undefined,
  requestId: string,
  now = new Date(),
): { experimentId: string } | null {
  if (!secret || secret.length < 32 || !token || token.length > 850) return null
  const match = TOKEN.exec(token)
  if (!match) return null
  const expected = Buffer.from(signature(secret, match[1]!))
  const supplied = Buffer.from(match[2]!)
  if (!timingSafeEqual(expected, supplied)) return null
  try {
    const value: unknown = JSON.parse(
      Buffer.from(match[1]!, "base64url").toString(),
    )
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (
      Object.keys(row).sort().join(",") !== "e,r,t" ||
      typeof row.e !== "string" ||
      !EXPERIMENT_ID.test(row.e) ||
      row.r !== requestId ||
      typeof row.t !== "number" ||
      !Number.isSafeInteger(row.t) ||
      row.t > now.getTime() ||
      now.getTime() >= row.t + RETENTION_MS
    )
      return null
    return { experimentId: row.e }
  } catch {
    return null
  }
}
