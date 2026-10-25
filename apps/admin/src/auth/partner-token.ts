// Pure helpers for the partner API key token format
// `jfp_search_<keyId>_<random>`.
//
// `keyId` is a 12-char operator-visible identifier (URL-safe alphabet
// excluding `_` so the split delimiter is unambiguous, and excluding
// visually-confusable `0/O/I/l/1`). `random` is base64url(32 bytes) = 43
// chars of entropy — the actual credential.
//
// Storage uses `sha256(rawToken)` hex; comparison uses `timingSafeEqual`
// on the decoded 32-byte buffers. The keyId travels in plaintext through
// the token prefix AND is the dashboard / log identifier, so it must never
// be treated as secret.
//
// Co-located with the other bearer validators so the partner branch can
// import the parser without crossing the service-layer boundary.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/** Token prefix is `jfp_<surface>_`. v1 only emits `jfp_search_`. */
export const PARTNER_TOKEN_PREFIX = "jfp_search_" as const

/** Length of the random tail in raw bytes (base64url encodes to 43 chars). */
export const PARTNER_TOKEN_RANDOM_BYTES = 32

/** Length of the keyId segment. */
export const PARTNER_KEY_ID_LENGTH = 12

/**
 * keyId alphabet: 54 URL-safe chars, no `_` (delimiter), no `0 O I l 1`
 * (visually confusable). Chosen for operator readability when shared via
 * Slack or pasted into Doppler. log2(54) ≈ 5.75 bits/char × 12 chars ≈ 69
 * bits of entropy — more than enough for a non-secret identifier.
 */
const KEY_ID_ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

/** Bearer prefix on the Authorization header, case-insensitive. */
const BEARER_PREFIX = /^Bearer\s+/i

/**
 * Regex that matches the full token shape AFTER `Bearer ` is stripped.
 * Captures `keyId` and the random tail. Anchored on both ends.
 *
 * Random tail uses base64url's `-` and `_` alongside `[A-Za-z0-9]` — but
 * note `_` IS allowed inside the random segment (it's the LAST `_` in the
 * token that marks the boundary, and we control that by fixing keyId at
 * exactly 12 alphabet chars).
 */
const TOKEN_REGEX = new RegExp(
  `^jfp_search_([${KEY_ID_ALPHABET}]{${PARTNER_KEY_ID_LENGTH}})_([A-Za-z0-9_-]{43})$`,
)

export type ParsedPartnerToken = {
  /** The full token as presented (sans `Bearer `). */
  rawToken: string
  /** The 12-char keyId pulled out of the prefix. */
  keyId: string
}

/**
 * Parse an `Authorization: Bearer …` header value into the partner-token
 * shape. Returns `null` on any mismatch — caller falls through to the
 * env-CSV branches without logging the failure. `null` covers: missing
 * header, missing `Bearer ` prefix, wrong overall prefix, malformed
 * keyId chars, malformed random length.
 */
export function parsePartnerToken(
  authHeader: string | null,
): ParsedPartnerToken | null {
  if (!authHeader) return null
  if (!BEARER_PREFIX.test(authHeader)) return null
  const rawToken = authHeader.replace(BEARER_PREFIX, "")
  if (rawToken.length === 0) return null
  const match = TOKEN_REGEX.exec(rawToken)
  if (!match) return null
  return { rawToken, keyId: match[1] }
}

/** Generate a fresh partner token. Returns the three forms the service needs. */
export function generatePartnerToken(): {
  keyId: string
  rawToken: string
  keyHash: string
} {
  const keyId = generateKeyId()
  const random = randomBytes(PARTNER_TOKEN_RANDOM_BYTES).toString("base64url")
  const rawToken = `${PARTNER_TOKEN_PREFIX}${keyId}_${random}`
  const keyHash = hashRawToken(rawToken)
  return { keyId, rawToken, keyHash }
}

/** `sha256(rawToken)` as 64-char hex. The stored form on `PartnerApiKey.keyHash`. */
export function hashRawToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex")
}

/**
 * Constant-time equality on two hex-encoded sha256 digests. Decodes both
 * to Buffers, asserts equal length (always 32 bytes for valid hex sha256
 * input — but a malformed input would otherwise crash `timingSafeEqual`),
 * then compares.
 *
 * Returns `false` on any decode anomaly so a caller never has to worry
 * about `RangeError` from a bad input.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let bufA: Buffer
  let bufB: Buffer
  try {
    bufA = Buffer.from(a, "hex")
    bufB = Buffer.from(b, "hex")
  } catch {
    return false
  }
  if (bufA.length === 0 || bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Generate a 12-char keyId from `KEY_ID_ALPHABET` using `randomBytes` as
 * the entropy source. Uses rejection sampling on each byte so the output
 * distribution is uniform across the alphabet (modulo bias would skew the
 * first few chars toward the lower half of byte space).
 */
function generateKeyId(): string {
  const out: string[] = []
  // Overshoot the byte budget so we never need a second `randomBytes` call
  // for the realistic rejection rate. 256 / 54 ≈ 4.74, so 24 bytes covers
  // 12 chars with very high probability even after rejection.
  const buf = randomBytes(PARTNER_KEY_ID_LENGTH * 4)
  for (let i = 0; out.length < PARTNER_KEY_ID_LENGTH && i < buf.length; i++) {
    const byte = buf[i]
    // Reject bytes that would bias the distribution. 256 mod 54 = 40, so
    // bytes 0-215 are usable (the largest multiple of 54 ≤ 256 is 216).
    if (byte >= 216) continue
    out.push(KEY_ID_ALPHABET[byte % 54])
  }
  if (out.length < PARTNER_KEY_ID_LENGTH) {
    // Pathologically unlucky — recurse with a fresh draw.
    return generateKeyId()
  }
  return out.join("")
}
