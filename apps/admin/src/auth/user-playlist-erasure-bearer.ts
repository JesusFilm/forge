import { createHmac, timingSafeEqual } from "node:crypto"

import { env } from "@/config/env"

const BEARER_PREFIX = /^Bearer\s+/i

export function isValidUserPlaylistErasureBearer(
  authHeader: string | null,
): boolean {
  if (!authHeader || !BEARER_PREFIX.test(authHeader)) return false
  const presented = Buffer.from(authHeader.replace(BEARER_PREFIX, ""))
  if (presented.byteLength === 0) return false

  let matched = false
  for (const candidate of (env.USER_PLAYLIST_ERASURE_API_KEYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const expected = Buffer.from(candidate)
    if (
      expected.byteLength === presented.byteLength &&
      timingSafeEqual(expected, presented)
    ) {
      matched = true
    }
  }
  return matched
}

export function getUserPlaylistErasureSubjectDigestKey(): Uint8Array | null {
  const encoded = env.USER_PLAYLIST_ERASURE_SUBJECT_DIGEST_KEY
  if (!encoded) return null
  const decoded = Buffer.from(encoded, "base64url")
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== encoded) {
    return null
  }
  return decoded
}

export function digestErasedUserPlaylistSubject(
  ownerSubject: string,
  key: Uint8Array,
): Uint8Array {
  return createHmac("sha256", key).update(ownerSubject, "utf8").digest()
}
