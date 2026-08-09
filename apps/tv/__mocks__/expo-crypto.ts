// Manual mock for the native module. Jest auto-applies __mocks__ entries for
// node_modules packages, so no test needs to call jest.mock() for this.
//
// Backed by Node's real crypto rather than fixed strings on purpose: callers
// use these for PKCE verifiers and viewer ids, and constants would make
// collision and uniqueness assertions pass vacuously.
import nodeCrypto from "node:crypto"

export const CryptoDigestAlgorithm = { SHA256: "SHA-256" } as const
export const CryptoEncoding = { BASE64: "base64", HEX: "hex" } as const

export function randomUUID(): string {
  return nodeCrypto.randomUUID()
}

export function getRandomBytes(byteCount: number): Uint8Array {
  return new Uint8Array(nodeCrypto.randomBytes(byteCount))
}

export async function getRandomBytesAsync(
  byteCount: number,
): Promise<Uint8Array> {
  return new Uint8Array(nodeCrypto.randomBytes(byteCount))
}

export async function digestStringAsync(
  algorithm: string,
  data: string,
  options?: { encoding?: string },
): Promise<string> {
  const nodeAlgo = algorithm.toLowerCase().replace("-", "")
  const hash = nodeCrypto.createHash(nodeAlgo).update(data, "utf8")
  return options?.encoding === "base64"
    ? hash.digest("base64")
    : hash.digest("hex")
}
