/**
 * RFC 9562 version 4 UUID from the browser's CSPRNG, usable outside a secure
 * context.
 *
 * `crypto.randomUUID()` is `[SecureContext]`: it is missing on plain-HTTP
 * origins (a tailnet preview, a captive portal) and in Firefox before 95.
 * `crypto.getRandomValues()` is not secure-context gated and is the same
 * CSPRNG `randomUUID()` draws from, so the fallback keeps the full 122 random
 * bits. There is deliberately no `Math.random` fallback: callers send these
 * ids to routes that treat them as unguessable visit and exposure identities.
 */
export class RandomUuidUnavailableError extends Error {
  constructor() {
    super("No cryptographic random source is available")
    this.name = "RandomUuidUnavailableError"
  }
}

export function randomUuid(): string {
  const source = globalThis.crypto
  if (typeof source?.randomUUID === "function") return source.randomUUID()
  if (typeof source?.getRandomValues !== "function") {
    throw new RandomUuidUnavailableError()
  }
  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-")
}
