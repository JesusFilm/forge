import "server-only"

import { createHmac, randomBytes } from "node:crypto"
import { GoogleAuth } from "google-auth-library"
import { z } from "zod"

import {
  acceptsIntegrityVerdict,
  type IntegrityPayload,
} from "../lib/grantVerdict"

import { config, requireConfig } from "./config"
import { activeGrantForSession } from "./feedbackState"

export const grantRequestSchema = z
  .object({
    challengeId: z.uuid(),
    installationId: z.uuid(),
    publicKey: z.string().min(80).max(1000),
    keyFingerprint: z.string().min(30).max(100),
    packageName: z.string().max(100),
    versionCode: z.number().int().positive(),
    tvMode: z.boolean(),
    signature: z.string().min(40).max(300),
    integrityToken: z.string().min(100).max(20000),
  })
  .strict()

export type GrantRequest = z.infer<typeof grantRequestSchema>

export function grantMode(): "off" | "observe" | "enforce" {
  return (
    config().FEEDBACK_GRANT_MODE ??
    (process.env.NODE_ENV === "production" ? "enforce" : "off")
  )
}

export {
  canonicalGrantRequest,
  nextUtcMidnight,
  publicKeyMatches,
} from "../lib/grantProof"

export function hashSecret(secret: string): string {
  return createHmac(
    "sha256",
    requireConfig("FEEDBACK_SESSION_SECRET").FEEDBACK_SESSION_SECRET,
  )
    .update(secret)
    .digest("hex")
}

export async function verifyPlayIntegrity(
  input: GrantRequest,
  canonical: string,
): Promise<boolean> {
  const env = requireConfig(
    "FEEDBACK_PLAY_PACKAGE",
    "FEEDBACK_PLAY_CERT_SHA256",
    "FEEDBACK_PLAY_ALLOWED_VERSIONS",
    "FEEDBACK_GOOGLE_SERVICE_ACCOUNT_JSON",
  )
  if (input.packageName !== env.FEEDBACK_PLAY_PACKAGE || !input.tvMode)
    return false
  const auth = new GoogleAuth({
    credentials: JSON.parse(env.FEEDBACK_GOOGLE_SERVICE_ACCOUNT_JSON) as Record<
      string,
      string
    >,
    scopes: ["https://www.googleapis.com/auth/playintegrity"],
  })
  const client = await auth.getClient()
  const accessToken = await client.getAccessToken()
  if (!accessToken.token) return false
  const response = await fetch(
    `https://playintegrity.googleapis.com/v1/${encodeURIComponent(env.FEEDBACK_PLAY_PACKAGE)}:decodeIntegrityToken`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ integrity_token: input.integrityToken }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    },
  )
  if (!response.ok) {
    await response.body?.cancel()
    return false
  }
  const decoded = (await response.json()) as {
    tokenPayloadExternal?: IntegrityPayload
  }
  const payload = decoded.tokenPayloadExternal
  return acceptsIntegrityVerdict(payload, input, canonical, {
    packageName: env.FEEDBACK_PLAY_PACKAGE,
    certs: env.FEEDBACK_PLAY_CERT_SHA256.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    versions: env.FEEDBACK_PLAY_ALLOWED_VERSIONS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  })
}

export function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}
export function randomGrantSecret(): string {
  return randomBytes(32).toString("base64url")
}
export function randomReference(): string {
  return `WT-${randomBytes(5).toString("hex").toUpperCase()}`
}

export async function activeGrant(
  sessionId: string,
): Promise<{ id: string; installation_id: string; utc_day: string } | null> {
  if (grantMode() !== "enforce") return null
  const grant = await activeGrantForSession(sessionId)
  return grant
    ? {
        id: grant.id,
        installation_id: grant.installationId,
        utc_day: grant.day,
      }
    : null
}
