// Per-launch viewer id sent as `x-viewer-id` on search so admin buckets each
// install separately (CGNAT-immune) vs by shared carrier-egress IP. In-memory
// only; cross-launch persistence + account-merge is a login-era follow-up.

let cachedViewerId: string | undefined

// RFC4122 v4 without a dependency — Hermes lacks crypto.randomUUID. Exported so
// the fallback path can be tested directly (the Node test env has randomUUID).
export function uuidV4Fallback(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Runtime randomUUID when present, else the RFC4122 v4 fallback (Hermes). */
export function randomUUIDCompat(): string {
  const runtimeCrypto = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto
  return runtimeCrypto?.randomUUID?.() ?? uuidV4Fallback()
}

/** Stable per-launch viewer id, generated lazily on first use. */
export function getViewerId(): string {
  cachedViewerId ??= randomUUIDCompat()
  return cachedViewerId
}
