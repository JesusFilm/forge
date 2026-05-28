import { randomUUID } from "node:crypto"

import { isWatchDownloadAccountGateEnabled } from "@/lib/feature-flags"

export const DOWNLOAD_GATE_ROLLOUT_COOKIE = "forge_download_gate_rollout"

type DownloadGateEvaluation = {
  enabled: boolean
  setCookieHeader?: string
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const item of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = item.trim().split("=")
    if (rawKey === name) return decodeURIComponent(rawValue.join("=") ?? "")
  }
  return null
}

function serializeRolloutCookie(value: string): string {
  const parts = [
    `${DOWNLOAD_GATE_ROLLOUT_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/watch",
    "Max-Age=31536000",
    "HttpOnly",
    "SameSite=Lax",
  ]
  if (process.env.NODE_ENV === "production") parts.push("Secure")
  return parts.join("; ")
}

function evaluation(
  enabled: boolean,
  setCookieHeader: string | undefined,
): DownloadGateEvaluation {
  return setCookieHeader ? { enabled, setCookieHeader } : { enabled }
}

export async function evaluateDownloadAccountGate(
  request: Request,
): Promise<DownloadGateEvaluation> {
  const existingKey = readCookie(
    request.headers.get("cookie"),
    DOWNLOAD_GATE_ROLLOUT_COOKIE,
  )
  const rolloutKey = existingKey || randomUUID()
  const setCookieHeader = existingKey
    ? undefined
    : serializeRolloutCookie(rolloutKey)
  const url = new URL(request.url)
  const enabled = await isWatchDownloadAccountGateEnabled({
    anonymous: true,
    key: rolloutKey,
    kind: "user",
    custom: {
      route: url.pathname,
    },
  })

  return evaluation(enabled, setCookieHeader)
}
