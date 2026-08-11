// Pure decision layer for the Continue Watching account sync (feat-322
// U4.6). Split from `watchProgressSync.ts` so tests can exercise every rule
// without importing the Apollo client (which reaches the native Datadog SDK
// and cannot be parsed under jest — the `recordWatchEventDocument.ts`
// precedent, one module over).
//
// Server conflict story (context for the mapping): admin floors and clamps
// the numbers, derives `completed`, and keeps the NEWEST `updatedAt` per
// video (a monotonic guard that DROPS entries whose stamp cannot be parsed —
// the shelf's ISO stamps ride through untouched). `languageSlug` is nullable
// on the wire and the shelf does not capture the dub language yet; it is
// omitted until capture lands (follow-up).

import {
  MAX_CONTINUE_WATCHING,
  RESUME_FINISHED_PROGRESS,
  type ContinueWatchingEntry,
} from "./continueWatching"

/** One `WatchProgressUpsertInput` as the wire expects it. The field names are
 *  the CONTRACT — `watchProgressSync.test.ts` pins them against fixtures so a
 *  local rename cannot silently drift off admin's input type. */
export type WatchProgressUpsertEntry = {
  videoId: string
  videoSlug: string
  positionSeconds: number
  durationSeconds: number
  updatedAt: string
}

/**
 * Shelf → wire. Entries the server would reject are DROPPED, not defaulted:
 * a null duration cannot satisfy the non-null `durationSeconds: Float!`, and
 * inventing one would poison the account row for every other device.
 */
export function toWatchProgressUpsertEntries(
  entries: readonly ContinueWatchingEntry[],
): WatchProgressUpsertEntry[] {
  const mapped: WatchProgressUpsertEntry[] = []
  for (const entry of entries) {
    const duration = entry.durationSeconds
    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
      continue
    }
    if (!Number.isFinite(entry.positionSeconds) || entry.positionSeconds < 0) {
      continue
    }
    if (entry.updatedAt.length === 0) continue
    mapped.push({
      videoId: entry.videoId,
      videoSlug: entry.slug,
      positionSeconds: entry.positionSeconds,
      durationSeconds: duration,
      updatedAt: entry.updatedAt,
    })
    if (mapped.length >= MAX_CONTINUE_WATCHING) break
  }
  return mapped
}

/** A defensively-narrowed `myWatchProgress` row. Every field is nullable on
 *  the wire; a row that cannot anchor a merge (no id, no usable numbers) is
 *  dropped at parse rather than guessed at. */
export type AccountWatchProgressRow = {
  videoId: string
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  updatedAt: string | null
}

export function parseAccountProgressRows(
  rows: unknown,
): AccountWatchProgressRow[] {
  if (!Array.isArray(rows)) return []
  const parsed: AccountWatchProgressRow[] = []
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue
    const r = row as {
      videoId?: unknown
      positionSeconds?: unknown
      durationSeconds?: unknown
      completed?: unknown
      updatedAt?: unknown
    }
    if (typeof r.videoId !== "string" || r.videoId.length === 0) continue
    if (typeof r.positionSeconds !== "number" || r.positionSeconds < 0) continue
    if (typeof r.durationSeconds !== "number" || r.durationSeconds <= 0) {
      continue
    }
    parsed.push({
      videoId: r.videoId,
      positionSeconds: r.positionSeconds,
      durationSeconds: r.durationSeconds,
      completed: r.completed === true,
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    })
  }
  return parsed
}

/** True when the account row is strictly further along than the local entry —
 *  ratio first (what the UI shows), seconds when the local duration is
 *  unknown. Same semantic as anonymousMerge's reconciliation. */
function accountRowIsFurtherAlong(
  row: AccountWatchProgressRow,
  local: ContinueWatchingEntry,
): boolean {
  const rowRatio = row.positionSeconds / row.durationSeconds
  if (local.progress != null && Number.isFinite(local.progress)) {
    return rowRatio > local.progress
  }
  return row.positionSeconds > local.positionSeconds
}

/**
 * Fold account rows into the local shelf (pure; the caller holds the shelf
 * lock via `updateContinueWatching`).
 *
 * Per shelf entry with a matching account row:
 *  - account says FINISHED (completed flag, or at/past the finished ratio) →
 *    the entry drops, exactly as a local watch-to-end would drop it;
 *  - account is further along → local position/duration/progress advance to
 *    the account's (display fields stay local — the server has none);
 *  - otherwise the local entry stands (it is the furthest this account got).
 *
 * Account rows for videos the shelf does not know are SKIPPED — server rows
 * carry no slug/title/imageUrl and a card cannot render without them.
 * Surfacing account-only videos needs a catalog lookup (follow-up), not a
 * half-rendered card here.
 */
export function mergeAccountRowsIntoShelf(
  local: readonly ContinueWatchingEntry[],
  rows: readonly AccountWatchProgressRow[],
): ContinueWatchingEntry[] {
  const byVideoId = new Map(rows.map((row) => [row.videoId, row]))
  const merged: ContinueWatchingEntry[] = []
  for (const entry of local) {
    const row = byVideoId.get(entry.videoId)
    if (row == null) {
      merged.push(entry)
      continue
    }
    const rowRatio = row.positionSeconds / row.durationSeconds
    if (row.completed || rowRatio >= RESUME_FINISHED_PROGRESS) continue
    if (!accountRowIsFurtherAlong(row, entry)) {
      merged.push(entry)
      continue
    }
    merged.push({
      ...entry,
      positionSeconds: Math.floor(row.positionSeconds),
      durationSeconds: Math.floor(row.durationSeconds),
      progress: rowRatio,
      updatedAt: row.updatedAt ?? entry.updatedAt,
    })
  }
  return merged
}
