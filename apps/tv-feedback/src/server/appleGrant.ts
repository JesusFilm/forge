import "server-only"

import { createPrivateKey, randomUUID, sign } from "node:crypto"

import { z } from "zod"

import { requireConfig } from "./config"
import { grantRequestSchema } from "./tvGrant"

export const appleGrantRequestSchema = grantRequestSchema
  .omit({ integrityToken: true })
  .extend({ deviceToken: z.string().min(100).max(20_000) })

export type AppleGrantRequest = z.infer<typeof appleGrantRequestSchema>

export async function verifyAppleDeviceCheck(
  input: AppleGrantRequest,
): Promise<boolean> {
  if (
    requireConfig("FEEDBACK_APPLE_DEVICECHECK_ENABLED")
      .FEEDBACK_APPLE_DEVICECHECK_ENABLED !== "true"
  )
    return false
  const env = requireConfig(
    "FEEDBACK_APPLE_TEAM_ID",
    "FEEDBACK_APPLE_KEY_ID",
    "FEEDBACK_APPLE_PRIVATE_KEY",
    "FEEDBACK_APPLE_BUNDLE_ID",
    "FEEDBACK_APPLE_ALLOWED_BUILDS",
  )
  if (
    input.packageName !== env.FEEDBACK_APPLE_BUNDLE_ID ||
    !input.tvMode ||
    !env.FEEDBACK_APPLE_ALLOWED_BUILDS.split(",")
      .map((value) => value.trim())
      .includes(String(input.versionCode))
  )
    return false
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: env.FEEDBACK_APPLE_KEY_ID }),
  ).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: env.FEEDBACK_APPLE_TEAM_ID,
      iat: Math.floor(Date.now() / 1000),
    }),
  ).toString("base64url")
  const signingInput = `${header}.${payload}`
  const privateKey = createPrivateKey(
    env.FEEDBACK_APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  )
  const signature = sign(null, Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url")
  const domain =
    env.FEEDBACK_APPLE_DEVICECHECK_ENV === "development"
      ? "api.development.devicecheck.apple.com"
      : "api.devicecheck.apple.com"
  const response = await fetch(`https://${domain}/v1/validate_device_token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${signingInput}.${signature}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      device_token: input.deviceToken,
      transaction_id: randomUUID(),
      timestamp: Date.now(),
    }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  })
  await response.body?.cancel()
  return response.ok
}
