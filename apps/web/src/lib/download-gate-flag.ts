import { randomUUID } from "node:crypto"

import type { LDClient, LDContext } from "@launchdarkly/node-server-sdk"

import { env } from "@/env"

export const DOWNLOAD_ACCOUNT_GATE_FLAG_KEY = "web-download-account-gate"
export const DOWNLOAD_GATE_ROLLOUT_COOKIE = "forge_download_gate_rollout"

type DownloadGateEvaluation = {
  enabled: boolean
  setCookieHeader?: string
}

let launchDarklyClientPromise: Promise<LDClient | null> | undefined

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

function fallbackVariation(): boolean {
  return env.WEB_DOWNLOAD_ACCOUNT_GATE_FALLBACK
}

function evaluation(
  enabled: boolean,
  setCookieHeader: string | undefined,
): DownloadGateEvaluation {
  return setCookieHeader ? { enabled, setCookieHeader } : { enabled }
}

async function getLaunchDarklyClient(): Promise<LDClient | null> {
  const sdkKey = env.LAUNCHDARKLY_SDK_KEY?.trim()
  if (!sdkKey) return null

  launchDarklyClientPromise ??= (async () => {
    try {
      const ld = await import("@launchdarkly/node-server-sdk")
      const client = ld.init(sdkKey, {
        logger: ld.basicLogger({ level: "warn" }),
      })
      await client.waitForInitialization({ timeout: 3 })
      return client
    } catch (err) {
      console.warn("[download-gate] launchdarkly_unavailable", {
        err: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  })()

  return launchDarklyClientPromise
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
  const fallback = fallbackVariation()

  const client = await getLaunchDarklyClient()
  if (!client) return evaluation(fallback, setCookieHeader)

  const context = {
    anonymous: true,
    key: rolloutKey,
    kind: "user",
  } satisfies LDContext

  try {
    return evaluation(
      await client.boolVariation(
        DOWNLOAD_ACCOUNT_GATE_FLAG_KEY,
        context,
        fallback,
      ),
      setCookieHeader,
    )
  } catch (err) {
    console.warn("[download-gate] launchdarkly_variation_failed", {
      err: err instanceof Error ? err.message : String(err),
    })
    return evaluation(fallback, setCookieHeader)
  }
}
