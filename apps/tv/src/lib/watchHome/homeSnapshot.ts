// SYNC: the Home-snapshot parts of apps/mobile/src/lib/watchHomePersistence.ts.
// Pure parse/serialize for the stale-while-revalidate snapshot — the prior
// launch's home videos, painted instantly next launch while the live fetch
// revalidates. TV has no played-ids / carousel memory, so only this schema ports.

import type { WatchHomeVideoInput } from "./model"

export const WATCH_HOME_SNAPSHOT_STORAGE_KEY = "watch-home-videos-snapshot"

/** Bump when the WatchHomeVideo fragment / WatchHomeVideoInput shape changes,
 *  so an old-shape snapshot is rejected rather than fed to the model builder. */
export const WATCH_HOME_SNAPSHOT_VERSION = 1

/** A stale snapshot is only the first paint (the live fetch replaces it in
 *  seconds), so even a days-old one renders today's lineup fine. */
export const WATCH_HOME_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Stay clear of Android AsyncStorage's ~2MB per-item limit (payload ~450KB). */
export const WATCH_HOME_SNAPSHOT_MAX_BYTES = 1_500_000

export type WatchHomeSnapshot = {
  videos: readonly WatchHomeVideoInput[]
  persistedAt: number
}

/**
 * Parse the persisted Home snapshot. Null for anything unexpected (version drift,
 * expiry, empty/non-array videos) so launch degrades to the pre-snapshot skeleton.
 * Items are shallow-checked only; deep drift is caught by the version gate.
 */
export function parseStoredHomeSnapshot(
  raw: string | null,
  now: Date,
): WatchHomeSnapshot | null {
  if (raw == null) return null
  try {
    const data = JSON.parse(raw) as {
      version?: unknown
      persistedAt?: unknown
      videos?: unknown
    } | null
    if (data == null || typeof data !== "object") return null
    if (data.version !== WATCH_HOME_SNAPSHOT_VERSION) return null
    if (typeof data.persistedAt !== "number") return null
    if (now.getTime() - data.persistedAt > WATCH_HOME_SNAPSHOT_MAX_AGE_MS) {
      return null
    }
    if (!Array.isArray(data.videos)) return null
    const videos = data.videos.filter(
      (video): video is WatchHomeVideoInput =>
        video != null && typeof video === "object",
    )
    // An empty snapshot must not paint the full-empty "No content available"
    // state over the loading skeleton.
    if (videos.length === 0) return null
    return { videos, persistedAt: data.persistedAt }
  } catch {
    return null
  }
}

export function serializeHomeSnapshot(
  videos: readonly WatchHomeVideoInput[],
  now: Date,
): string {
  return serializeHomeSnapshotFromVideosJson(JSON.stringify(videos), now)
}

/**
 * Envelope around an ALREADY-serialized videos array so the hot path stringifies
 * the ~450KB payload once, reusing it for both the equality compare and the
 * persisted blob. `videosJson` must be a JSON array string.
 */
export function serializeHomeSnapshotFromVideosJson(
  videosJson: string,
  now: Date,
): string {
  return `{"version":${WATCH_HOME_SNAPSHOT_VERSION},"persistedAt":${now.getTime()},"videos":${videosJson}}`
}
