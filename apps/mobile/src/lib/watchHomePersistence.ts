/**
 * Storage schema for the Home tab's cross-restart memory:
 *
 *   - Played ids: web's localStorage `carousel-played-ids` — `{ month, ids }`,
 *     dropped wholesale when the stored month differs from the current UTC
 *     month, so rotation exclusions reset monthly.
 *   - Carousel session: web's sessionStorage `carousel-current-video` — the
 *     pool-rotation position the queue resumes from, expired after 24h.
 *   - Home snapshot: the last successful `watchHomeVideos` response, painted
 *     immediately on launch while the live fetch revalidates in the background
 *     (the resolver alone costs 2.5-6s of TTFB against prod admin).
 *
 * Pure parse/serialize only (the watchPreferences.ts pattern). AsyncStorage
 * I/O lives in {@link useWatchHomeCarouselMemory} and {@link useWatchHome},
 * the Home screen's owners of this state.
 */
import type { WatchHomeVideoInput } from "./watchHome/model"

export const WATCH_HOME_PLAYED_IDS_STORAGE_KEY = "watch-home-played-ids"
export const WATCH_HOME_CAROUSEL_SESSION_STORAGE_KEY =
  "watch-home-carousel-session"

/** Web parity: loadWatchHomeCurrentVideoSession discards sessions older than 24h. */
export const WATCH_HOME_CAROUSEL_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type WatchHomeCarouselSession = {
  /** The video slide that was showing — kept for debugging, not queue input. */
  videoId: string
  /** Pool-rotation position; queue rebuilds resume here (startPoolIndex). */
  poolIndex: number
  timestamp: number
}

/** Web parity: currentStorageMonth — UTC ISO month, e.g. "2026-06". */
export function currentStorageMonth(now: Date): string {
  return now.toISOString().slice(0, 7)
}

/**
 * Parse the persisted played-ids blob. Anything unexpected — never written,
 * malformed JSON, wrong shape, or a stale month — degrades to an empty set so
 * the queue simply rotates without exclusions.
 */
export function parseStoredPlayedIds(
  raw: string | null,
  now: Date,
): Set<string> {
  if (raw == null) return new Set()
  try {
    const data = JSON.parse(raw) as { month?: unknown; ids?: unknown } | null
    if (data == null || typeof data !== "object") return new Set()
    if (data.month !== currentStorageMonth(now)) return new Set()
    if (!Array.isArray(data.ids)) return new Set()
    return new Set(
      data.ids.filter((id): id is string => typeof id === "string"),
    )
  } catch {
    return new Set()
  }
}

export function serializePlayedIds(
  ids: ReadonlySet<string>,
  now: Date,
): string {
  return JSON.stringify({ month: currentStorageMonth(now), ids: [...ids] })
}

/**
 * Parse the persisted carousel session. Returns null for anything unexpected
 * or expired (>24h), so the queue falls back to startPoolIndex 0.
 */
export function parseStoredCarouselSession(
  raw: string | null,
  now: Date,
): WatchHomeCarouselSession | null {
  if (raw == null) return null
  try {
    const data = JSON.parse(raw) as Partial<WatchHomeCarouselSession> | null
    if (data == null || typeof data !== "object") return null
    if (
      typeof data.videoId !== "string" ||
      typeof data.timestamp !== "number" ||
      typeof data.poolIndex !== "number" ||
      !Number.isInteger(data.poolIndex) ||
      data.poolIndex < 0
    ) {
      return null
    }
    if (
      now.getTime() - data.timestamp >
      WATCH_HOME_CAROUSEL_SESSION_MAX_AGE_MS
    ) {
      return null
    }
    return {
      videoId: data.videoId,
      poolIndex: data.poolIndex,
      timestamp: data.timestamp,
    }
  } catch {
    return null
  }
}

export function serializeCarouselSession(
  session: WatchHomeCarouselSession,
): string {
  return JSON.stringify(session)
}

export const WATCH_HOME_SNAPSHOT_STORAGE_KEY = "watch-home-videos-snapshot"

/** Bump when the WatchHomeVideo fragment / WatchHomeVideoInput shape changes. */
export const WATCH_HOME_SNAPSHOT_VERSION = 1

/**
 * Longer than the carousel session's 24h: a stale snapshot is only the first
 * paint — the live fetch always replaces it seconds later — and the daily
 * rotation is computed on-device at queue-build time, so even a days-old
 * snapshot renders today's correct lineup.
 */
export const WATCH_HOME_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Stay clear of Android AsyncStorage's ~2MB per-item limit (payload is ~460KB today). */
export const WATCH_HOME_SNAPSHOT_MAX_BYTES = 1_500_000

export type WatchHomeSnapshot = {
  videos: readonly WatchHomeVideoInput[]
  persistedAt: number
}

/**
 * Parse the persisted Home snapshot. Returns null for anything unexpected —
 * version drift, expiry, empty or non-array videos — so launch degrades to
 * the network-blocked spinner it had before snapshots existed. Items are only
 * shallow-checked (objects); deep shape drift is covered by the version gate.
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
    // state over the loading spinner.
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
 * Envelope built around an ALREADY-serialized videos array so the hot path
 * (useWatchHome's network-land) stringifies the ~460KB payload exactly once,
 * reusing it for both the snapshot-equality compare and the persisted blob.
 * `videosJson` must be a JSON array string (callers produce it via
 * JSON.stringify of the videos array).
 */
export function serializeHomeSnapshotFromVideosJson(
  videosJson: string,
  now: Date,
): string {
  return `{"version":${WATCH_HOME_SNAPSHOT_VERSION},"persistedAt":${now.getTime()},"videos":${videosJson}}`
}
