/**
 * Offline-download manifest: the pure, I/O-free shape and (de)serialization for
 * one offline-download record, plus the index of which videos are downloaded.
 *
 * Follows the `watchPreferences.ts` split: this module owns the record type, the
 * storage key scheme, a tolerant `parse`, and `serialize` — and does NO
 * AsyncStorage I/O. `DownloadsProvider` performs the reads/writes (sim-verified,
 * a separate unit).
 *
 * Storage is SHARDED: one key per download (`offline.download.<videoSlug>`) plus
 * a single index key listing the downloaded video slugs, so no single blob
 * approaches the ~2MB AsyncStorage per-item cap as the library grows. The bulky
 * native task state lives in the download module's own store, not here, so a
 * record stays small.
 *
 * The manifest stores STABLE IDENTITY, never volatile URLs: a record carries the
 * dub + rendition `documentId` and the subtitle language slug, and fresh URLs
 * are re-resolved through `videoDub(id)` before each download/resume.
 */

export const OFFLINE_MANIFEST_VERSION = 1

export const OFFLINE_INDEX_STORAGE_KEY = "offline.downloads.index"

const RECORD_KEY_PREFIX = "offline.download."

/** AsyncStorage key for a single download record, keyed by video slug. */
export function offlineRecordKey(videoSlug: string): string {
  return `${RECORD_KEY_PREFIX}${videoSlug}`
}

export type OfflineDownloadState =
  | "queued"
  | "downloading"
  | "paused"
  | "failed"
  | "downloaded"
  | "canceled"

const VALID_STATES: ReadonlySet<string> = new Set<OfflineDownloadState>([
  "queued",
  "downloading",
  "paused",
  "failed",
  "downloaded",
  "canceled",
])

/**
 * Snapshot of the previous downloaded copy, kept on a record DURING a
 * non-destructive quality/language swap (U8): the old file stays playable until
 * the new download verifies, then the old is deleted; on failure the record
 * reverts to this snapshot. Absent on normal records.
 */
export type SwapFrom = {
  committedPath: string
  renditionDocumentId: string
  qualityLabel: string
  subtitleLanguageSlug: string | null
  totalBytes: number
  posterPath: string | null
}

export type OfflineDownloadRecord = {
  /** Schema version; a record from a different version is dropped on read. */
  version: number
  /** The video this offline copy belongs to (also the shard key). */
  videoSlug: string
  /** Stable identity for re-resolution — never the volatile URL. */
  dubDocumentId: string
  renditionDocumentId: string
  /** Human-facing quality label (e.g. "High"); a re-resolution fallback. */
  qualityLabel: string
  /** Human title for the offline library; an empty value falls back to slug. */
  title: string
  /** Chosen subtitle language slug, or null for "No subtitles". */
  subtitleLanguageSlug: string | null
  state: OfflineDownloadState
  /** Verified, playable local file path; null until the bundle completes. */
  committedPath: string | null
  /** In-progress (attempt-unique) local path; null when not transferring. */
  pendingPath: string | null
  /** Local poster path; null until downloaded (non-blocking sidecar). */
  posterPath: string | null
  bytesWritten: number
  totalBytes: number
  /** Present only mid-swap; see {@link SwapFrom}. */
  swapFrom?: SwapFrom | null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** Tolerant parse of the mid-swap snapshot; null unless it carries identity. */
function parseSwapFrom(value: unknown): SwapFrom | null {
  if (value == null || typeof value !== "object") return null
  const o = value as Record<string, unknown>
  const committedPath = asString(o.committedPath)
  const renditionDocumentId = asString(o.renditionDocumentId)
  if (!committedPath || !renditionDocumentId) return null
  return {
    committedPath,
    renditionDocumentId,
    qualityLabel: asString(o.qualityLabel) ?? "",
    subtitleLanguageSlug: asString(o.subtitleLanguageSlug),
    totalBytes: asFiniteNumber(o.totalBytes),
    posterPath: asString(o.posterPath),
  }
}

/**
 * Parse a stored record blob. Tolerant by design but STRICT about identity: a
 * record missing its stable identity (videoSlug / dubDocumentId /
 * renditionDocumentId), carrying an unknown state, or from a different schema
 * version returns null — meaning "no usable record". The caller treats null as
 * absent and lets launch reconciliation clean up any orphaned on-disk bytes.
 * A malformed blob can never throw on read.
 */
export function parseOfflineRecord(
  raw: string | null,
): OfflineDownloadRecord | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== "object") return null
  const obj = parsed as Record<string, unknown>

  if (obj.version !== OFFLINE_MANIFEST_VERSION) return null

  const videoSlug = asString(obj.videoSlug)
  const dubDocumentId = asString(obj.dubDocumentId)
  const renditionDocumentId = asString(obj.renditionDocumentId)
  if (!videoSlug || !dubDocumentId || !renditionDocumentId) return null

  const state = obj.state
  if (typeof state !== "string" || !VALID_STATES.has(state)) return null

  return {
    version: OFFLINE_MANIFEST_VERSION,
    videoSlug,
    dubDocumentId,
    renditionDocumentId,
    qualityLabel: asString(obj.qualityLabel) ?? "",
    title: asString(obj.title) ?? "",
    subtitleLanguageSlug: asString(obj.subtitleLanguageSlug),
    state: state as OfflineDownloadState,
    committedPath: asString(obj.committedPath),
    pendingPath: asString(obj.pendingPath),
    posterPath: asString(obj.posterPath),
    bytesWritten: asFiniteNumber(obj.bytesWritten),
    totalBytes: asFiniteNumber(obj.totalBytes),
    swapFrom: parseSwapFrom(obj.swapFrom),
  }
}

export function serializeOfflineRecord(record: OfflineDownloadRecord): string {
  return JSON.stringify({ ...record, version: OFFLINE_MANIFEST_VERSION })
}

/**
 * Parse the index of downloaded video slugs. Tolerant: a missing/malformed blob
 * or any non-string entries degrade to a clean string array rather than
 * throwing, and duplicates are removed.
 */
export function parseOfflineIndex(raw: string | null): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const slugs = parsed.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  )
  return Array.from(new Set(slugs))
}

export function serializeOfflineIndex(slugs: string[]): string {
  return JSON.stringify(Array.from(new Set(slugs)))
}
