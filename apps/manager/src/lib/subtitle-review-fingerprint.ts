import { createHash } from "node:crypto"

export function fingerprintSubtitleVtt(vtt: string): string {
  return createHash("sha256").update(vtt, "utf8").digest("hex")
}

export function fingerprintSubtitleBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
