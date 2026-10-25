// SYNC: mirrors apps/mobile/src/lib/viewer-id.ts.
//
// Per-launch viewer id sent as `x-viewer-id` on search so admin buckets each
// install separately (CGNAT-immune) vs by shared carrier-egress IP. In-memory
// only; cross-launch persistence + account-merge is a login-era follow-up.

import * as Crypto from "expo-crypto"

let cachedViewerId: string | undefined

// Kept only as the last resort below. Hermes has no CSPRNG, so this is not
// unguessable — it is a bucketing key, not a secret. expo-crypto now provides
// the real thing on device (feat-322 brought it in for PKCE), which is why the
// order below prefers it.
export function uuidV4Fallback(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Stable per-launch viewer id, generated lazily on first use.
 *
 * Preference order is deliberate: expo-crypto's native CSPRNG first, then the
 * runtime's own `crypto.randomUUID` (present under Node in tests), then the
 * Math.random shape. Each step is wrapped because a missing native module on a
 * platform we have not built for must degrade to a working id, never crash the
 * search path that depends on this header.
 */
export function getViewerId(): string {
  if (cachedViewerId) return cachedViewerId

  try {
    cachedViewerId = Crypto.randomUUID()
    return cachedViewerId
  } catch {
    // Native module unavailable — fall through.
  }

  const runtimeCrypto = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto
  cachedViewerId = runtimeCrypto?.randomUUID?.() ?? uuidV4Fallback()
  return cachedViewerId
}
