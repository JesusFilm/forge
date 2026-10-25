import "server-only"

import { hkdfSync } from "node:crypto"

import { EncryptJWT, jwtDecrypt } from "jose"

import { env } from "@/env"

const CAPABILITY_KIND = "watch_download"
const CAPABILITY_AUDIENCE = "watch-download"
const CAPABILITY_LIFETIME = "1d"
const CAPABILITY_KEY_CONTEXT = "watch-download-capability:v1\0"
const MAX_CAPABILITY_LENGTH = 4096

let cachedRootSecret: string | undefined
let cachedCapabilityKey: Buffer | undefined

export type WatchDownloadCapability = {
  downloadId: string
  variantId: string
  videoSlug: string
  target: string
  subject?: string
  event: {
    videoId: string
    videoDubId: string
    languageId: string | null
  }
}

type WatchDownloadCapabilityPayload = WatchDownloadCapability & {
  kind: typeof CAPABILITY_KIND
}

function capabilityKey(): Buffer {
  if (
    cachedCapabilityKey !== undefined &&
    cachedRootSecret === env.REVALIDATION_SECRET
  ) {
    return cachedCapabilityKey
  }
  cachedRootSecret = env.REVALIDATION_SECRET
  cachedCapabilityKey = Buffer.from(
    hkdfSync(
      "sha256",
      env.REVALIDATION_SECRET,
      Buffer.alloc(0),
      CAPABILITY_KEY_CONTEXT,
      32,
    ),
  )
  return cachedCapabilityKey
}

export async function createWatchDownloadCapability(
  capability: WatchDownloadCapability,
): Promise<string> {
  return new EncryptJWT({
    ...capability,
    kind: CAPABILITY_KIND,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setAudience(CAPABILITY_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(CAPABILITY_LIFETIME)
    .encrypt(capabilityKey())
}

export async function readWatchDownloadCapability(
  token: string | null,
): Promise<WatchDownloadCapability | null> {
  if (!token || token.length > MAX_CAPABILITY_LENGTH) return null

  try {
    const { payload } = await jwtDecrypt(token, capabilityKey(), {
      audience: CAPABILITY_AUDIENCE,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    })
    if (!isWatchDownloadCapabilityPayload(payload)) return null

    const capability: WatchDownloadCapability = {
      downloadId: payload.downloadId,
      variantId: payload.variantId,
      videoSlug: payload.videoSlug,
      target: payload.target,
      event: payload.event,
    }
    if (payload.subject) capability.subject = payload.subject
    return capability
  } catch {
    return null
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isWatchDownloadCapabilityPayload(
  payload: Record<string, unknown>,
): payload is WatchDownloadCapabilityPayload {
  if (
    payload.kind !== CAPABILITY_KIND ||
    !isNonEmptyString(payload.downloadId) ||
    !isNonEmptyString(payload.variantId) ||
    !isNonEmptyString(payload.videoSlug) ||
    !isNonEmptyString(payload.target) ||
    (payload.subject !== undefined && !isNonEmptyString(payload.subject)) ||
    payload.event == null ||
    typeof payload.event !== "object"
  ) {
    return false
  }

  const event = payload.event as Record<string, unknown>
  return (
    isNonEmptyString(event.videoId) &&
    isNonEmptyString(event.videoDubId) &&
    (event.languageId === null || isNonEmptyString(event.languageId))
  )
}
