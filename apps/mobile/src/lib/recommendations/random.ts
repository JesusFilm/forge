/**
 * Random values for the recommendation client. A session token must come from
 * a cryptographic source; a claim nonce is a correlation key bound to the
 * viewer credentials, so it may fall back to the runtime's plain generator.
 */
import { randomUUIDCompat } from "../viewer-id"

const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

/** Base64url without padding, the shape Admin mints its own tokens in. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined
    out += BASE64URL[a >> 2]
    out += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b != null) out += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c != null) out += BASE64URL[c & 63]
  }
  return out
}

type RandomFill = (bytes: Uint8Array) => void
type CryptoLike = { getRandomValues?: (array: Uint8Array) => unknown }

/** The runtime's own WebCrypto, where one exists (Node, a browser). */
function runtimeFill(): RandomFill | null {
  const crypto = (globalThis as { crypto?: CryptoLike }).crypto
  const getRandomValues = crypto?.getRandomValues
  if (typeof getRandomValues !== "function") return null
  return (bytes) => {
    getRandomValues.call(crypto, bytes)
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Hermes ships no WebCrypto; `expo-crypto` binds the platform's CSPRNG. It is
 * required lazily so module init and jest never touch the native module.
 */
function expoCryptoFill(): RandomFill | null {
  try {
    const getRandomValues = (require("expo-crypto") as CryptoLike)
      .getRandomValues
    if (typeof getRandomValues !== "function") return null
    return (bytes) => {
      getRandomValues(bytes)
    }
  } catch {
    return null
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

function secureFill(): RandomFill | null {
  return runtimeFill() ?? expoCryptoFill()
}

/** True when a cryptographic random source is reachable. */
export function hasSecureRandom(): boolean {
  return secureFill() != null
}

/**
 * 32 random bytes as base64url (43 chars), or null without a cryptographic
 * source. A source that throws, or leaves the buffer untouched (a mocked
 * native module), yields null rather than a weaker token.
 */
export function secureRandomToken(): string | null {
  const fill = secureFill()
  if (!fill) return null
  const bytes = new Uint8Array(32)
  try {
    fill(bytes)
  } catch {
    return null
  }
  if (bytes.every((byte) => byte === 0)) return null
  return toBase64Url(bytes)
}

/**
 * A claim nonce: at least 16 characters, unique per selection. Prefers the
 * cryptographic source; otherwise two RFC4122 v4 values from the runtime.
 */
export function randomClaimNonce(): string {
  return (
    secureRandomToken() ??
    `${randomUUIDCompat()}${randomUUIDCompat()}`.replace(/-/g, "")
  )
}

/** Event ids: kind-prefixed so a receipt can be read by eye, ≤191 chars. */
export function randomEventId(kind: string, suffix?: string): string {
  const id = `${kind}:${randomUUIDCompat()}${suffix ? `:${suffix}` : ""}`
  return id.slice(0, 191)
}
