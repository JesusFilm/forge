import AsyncStorage from "@react-native-async-storage/async-storage"
import { AppState, type AppStateStatus } from "react-native"
import type { ApolloClient, NormalizedCacheObject } from "@apollo/client"

import { env } from "../env"

/**
 * Hand-rolled, opt-in Apollo cache persistence.
 *
 * apollo3-cache-persist targets Apollo v3 and crashed this app on launch, so
 * this is a small best-effort implementation against v4's cache.extract() /
 * cache.restore(). Everything is guarded so the worst case is "boot cold",
 * never a crash. Gated behind EXPO_PUBLIC_FORGE_CACHE_PERSIST (default off) so
 * it ships dark until verified on a real (low-end Android) device via EAS —
 * the startup-restructure risk this carries must not reach users untested.
 *
 * What is persisted: a stripped snapshot of the normalized cache, excluding
 * volatile signed URLs (stream hls, download urls, subtitle vttSrc) which would
 * 404 after expiry — those are always re-fetched. The snapshot is version- and
 * TTL-gated and discarded on any mismatch.
 */

const STORAGE_KEY = "forge.apollo.cache"
const CACHE_VERSION = 1
const TTL_MS = 24 * 60 * 60 * 1000 // 24h — bounds staleness (no mobile revalidation webhook).
const MAX_BYTES = 1_000_000 // ~1MB; Android AsyncStorage per-item limit is ~2MB.
const RESTORE_TIMEOUT_MS = 400 // a slow/hung read must not block first paint.
const WRITE_DEBOUNCE_MS = 1000

type Snapshot = {
  version: number
  persistedAt: number
  data: NormalizedCacheObject
}

export function isCachePersistenceEnabled(): boolean {
  return env.EXPO_PUBLIC_FORGE_CACHE_PERSIST === "true"
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

/**
 * Restore the persisted snapshot into the cache on cold start. MUST run before
 * ApolloProvider mounts / before any query, or a network write races and this
 * restore would clobber fresh data. Bounded by a timeout: on a slow read the
 * app boots cold and any late-arriving read is discarded (we never restore
 * after returning).
 */
export async function restoreApolloCache(cache: {
  restore: (data: NormalizedCacheObject) => unknown
}): Promise<void> {
  if (!isCachePersistenceEnabled()) return
  try {
    const raw = await raceTimeout(
      AsyncStorage.getItem(STORAGE_KEY),
      RESTORE_TIMEOUT_MS,
    )
    if (raw == null) return
    const parsed = JSON.parse(raw) as Partial<Snapshot> | null
    if (!parsed || parsed.version !== CACHE_VERSION) return
    if (
      typeof parsed.persistedAt !== "number" ||
      Date.now() - parsed.persistedAt > TTL_MS
    )
      return
    if (parsed.data == null || typeof parsed.data !== "object") return
    cache.restore(parsed.data)
  } catch {
    // Any failure (corrupt blob, parse error, storage error) → boot cold.
  }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null
let writing = false
let appStateSub: { remove: () => void } | null = null

/** Persist on app background (the moment before the process may be killed). */
export function startCachePersistence(client: ApolloClient): void {
  if (!isCachePersistenceEnabled() || appStateSub) return
  appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "background" || state === "inactive") {
      void writeSnapshot(client)
    }
  })
}

/** Debounced write — call after data the user is likely to revisit lands. */
export function schedulePersist(client: ApolloClient): void {
  if (!isCachePersistenceEnabled()) return
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => void writeSnapshot(client), WRITE_DEBOUNCE_MS)
}

async function writeSnapshot(client: ApolloClient): Promise<void> {
  if (writing) return // single-flight: avoid interleaved writes.
  writing = true
  try {
    const snapshot: Snapshot = {
      version: CACHE_VERSION,
      persistedAt: Date.now(),
      data: stripVolatile(client.cache.extract() as NormalizedCacheObject),
    }
    const serialized = JSON.stringify(snapshot)
    // Over cap → skip the write and keep the last valid snapshot. Never trim
    // (trimming a normalized blob drops ref targets → dangling refs on restore).
    if (serialized.length > MAX_BYTES) return
    await AsyncStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // best-effort
  } finally {
    writing = false
  }
}

/**
 * Deep-strip volatile signed URLs from the extracted cache before persisting:
 * stream `hls` and subtitle `vttSrc` are nulled and `downloads` arrays emptied,
 * because signed/expiring URLs would 404 after the snapshot's TTL. Stable image
 * `url`s are preserved. Re-fetched fresh on the next cache-and-network read.
 */
function stripVolatile(data: NormalizedCacheObject): NormalizedCacheObject {
  return deepStrip(data) as NormalizedCacheObject
}

function deepStrip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepStrip)
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === "hls" || key === "vttSrc") out[key] = null
      else if (key === "downloads") out[key] = []
      else out[key] = deepStrip(val)
    }
    return out
  }
  return value
}
