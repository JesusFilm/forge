// Manual mock for the native module. Jest auto-applies __mocks__ entries for
// node_modules packages, so no test needs to call jest.mock() for this.
//
// Backed by real WebCrypto rather than fixed strings on purpose: callers use
// these for PKCE verifiers and viewer ids, and constants would make collision
// and uniqueness assertions pass vacuously.
//
// WebCrypto specifically (not `node:crypto`) because apps/tv's tsconfig has no
// Node types — the global is the one surface available to both.

export const CryptoDigestAlgorithm = { SHA256: "SHA-256" } as const
export const CryptoEncoding = { BASE64: "base64", HEX: "hex" } as const

export function randomUUID(): string {
  return globalThis.crypto.randomUUID()
}

export function getRandomBytes(byteCount: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(byteCount))
}

export async function getRandomBytesAsync(
  byteCount: number,
): Promise<Uint8Array> {
  return getRandomBytes(byteCount)
}

export async function digestStringAsync(
  algorithm: string,
  data: string,
  options?: { encoding?: string },
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    algorithm,
    new TextEncoder().encode(data),
  )
  const bytes = new Uint8Array(digest)
  if (options?.encoding === "base64") {
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
