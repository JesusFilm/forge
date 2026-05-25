import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const MUX_ARTIFACT_TOKEN_TTL_MS = 15 * 60 * 1000

function getArtifactAccessSecret(): string {
  if (!env.MANAGER_API_KEY) {
    throw new Error("MANAGER_API_KEY is required for Mux artifact access")
  }
  return env.MANAGER_API_KEY
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function buildSignaturePayload(
  jobId: string,
  artifactKey: string,
  expiresAt: string,
): string {
  return `${jobId}:${artifactKey}:${expiresAt}`
}

function signPayload(payload: string): string {
  return createHmac("sha256", getArtifactAccessSecret())
    .update(payload)
    .digest("hex")
}

export function resolveManagerPublicBaseUrl(): string {
  const explicitBaseUrl =
    process.env.MANAGER_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_MANAGER_URL ??
    process.env.APP_URL

  if (explicitBaseUrl) {
    return trimTrailingSlash(explicitBaseUrl)
  }

  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${trimTrailingSlash(process.env.RAILWAY_PUBLIC_DOMAIN)}`
  }

  if (process.env.VERCEL_URL) {
    return `https://${trimTrailingSlash(process.env.VERCEL_URL)}`
  }

  throw new Error(
    "Manager public base URL is not configured for Mux subtitle sync",
  )
}

export function buildMuxArtifactAccessUrl(input: {
  jobId: string
  artifactKey: string
  now?: number
  baseUrl?: string
}): string {
  const expiresAt = String(
    (input.now ?? Date.now()) + MUX_ARTIFACT_TOKEN_TTL_MS,
  )
  const payload = buildSignaturePayload(
    input.jobId,
    input.artifactKey,
    expiresAt,
  )
  const signature = signPayload(payload)
  const baseUrl = input.baseUrl ?? resolveManagerPublicBaseUrl()

  const url = new URL(
    `${baseUrl}/api/jobs/${encodeURIComponent(input.jobId)}/artifacts/${encodeURIComponent(input.artifactKey)}`,
  )
  url.searchParams.set("muxExpiresAt", expiresAt)
  url.searchParams.set("muxSignature", signature)
  return url.toString()
}

export function hasValidMuxArtifactAccessSignature(input: {
  jobId: string
  artifactKey: string
  expiresAt: string | null
  signature: string | null
  now?: number
}): boolean {
  if (!input.expiresAt || !input.signature) {
    return false
  }

  const expiresAtMs = Number(input.expiresAt)
  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs < (input.now ?? Date.now())
  ) {
    return false
  }

  const expected = signPayload(
    buildSignaturePayload(input.jobId, input.artifactKey, input.expiresAt),
  )

  const providedBuffer = Buffer.from(input.signature)
  const expectedBuffer = Buffer.from(expected)
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}
