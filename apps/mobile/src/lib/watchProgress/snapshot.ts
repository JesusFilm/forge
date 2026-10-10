/**
 * Versioned AsyncStorage persistence for the progress store (KTD8),
 * following the watchHomePersistence pattern: version gate, byte ceiling,
 * degrade-to-empty parsing. Pure parse/serialize — the provider owns I/O.
 *
 * The snapshot is account-tagged: a parsed snapshot for a different account
 * must never paint bars (the caller compares accountId before hydrating).
 */

import type { WatchProgressEntry } from "./store"

export const WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY = "watch-progress-snapshot"

/** Bump when the persisted shape changes — old snapshots then fail the gate. */
export const WATCH_PROGRESS_SNAPSHOT_VERSION = 1

/**
 * A stale snapshot only paints the first frame (the server read replaces it
 * seconds later), but a months-old one is more misleading than none.
 */
export const WATCH_PROGRESS_SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Server caps the record at 200 entries (~150B each); stay far under Android's ~2MB item limit. */
export const WATCH_PROGRESS_SNAPSHOT_MAX_BYTES = 200_000

export type WatchProgressStoredSnapshot = {
  accountId: string
  entries: WatchProgressEntry[]
  persistedAt: number
}

function isValidEntry(value: unknown): value is WatchProgressEntry {
  if (value == null || typeof value !== "object") return false
  const entry = value as Partial<WatchProgressEntry>
  return (
    typeof entry.videoId === "string" &&
    entry.videoId.length > 0 &&
    (entry.languageSlug === null || typeof entry.languageSlug === "string") &&
    typeof entry.positionSeconds === "number" &&
    Number.isFinite(entry.positionSeconds) &&
    typeof entry.durationSeconds === "number" &&
    Number.isFinite(entry.durationSeconds) &&
    typeof entry.completed === "boolean" &&
    typeof entry.updatedAt === "string"
  )
}

/**
 * Parse the persisted snapshot. Null for anything unexpected (unwritten,
 * bad JSON, version drift, expiry, missing account) so cold launch cleanly
 * waits for the server read instead of painting garbage.
 */
export function parseStoredProgressSnapshot(
  raw: string | null,
  now: Date,
): WatchProgressStoredSnapshot | null {
  if (raw == null) return null
  try {
    const data = JSON.parse(raw) as {
      version?: unknown
      accountId?: unknown
      entries?: unknown
      persistedAt?: unknown
    } | null
    if (data == null || typeof data !== "object") return null
    if (data.version !== WATCH_PROGRESS_SNAPSHOT_VERSION) return null
    if (typeof data.accountId !== "string" || data.accountId.length === 0) {
      return null
    }
    if (typeof data.persistedAt !== "number") return null
    if (now.getTime() - data.persistedAt > WATCH_PROGRESS_SNAPSHOT_MAX_AGE_MS) {
      return null
    }
    if (!Array.isArray(data.entries)) return null
    return {
      accountId: data.accountId,
      entries: data.entries.filter(isValidEntry),
      persistedAt: data.persistedAt,
    }
  } catch {
    return null
  }
}

/**
 * Serialize for persistence. Null when the blob would cross the byte
 * ceiling — refuse to write rather than risk the platform limit.
 */
export function serializeProgressSnapshot(
  accountId: string,
  entries: readonly WatchProgressEntry[],
  now: Date,
): string | null {
  const blob = JSON.stringify({
    version: WATCH_PROGRESS_SNAPSHOT_VERSION,
    accountId,
    entries,
    persistedAt: now.getTime(),
  })
  return blob.length > WATCH_PROGRESS_SNAPSHOT_MAX_BYTES ? null : blob
}
