/**
 * Account-bound offline queue (R7): positions recorded while offline wait
 * here and flush when connectivity returns. Entries are bound to the account
 * that recorded them and are DISCARDED rather than flushed if that account
 * is not the signed-in account at flush time (R7/R10). Pure functions —
 * the caller owns AsyncStorage I/O.
 *
 * Offline (downloaded) playback has no admin video id on device — the
 * downloads manifest stores only slugs — so queued entries may carry the
 * slug, which admin resolves server-side (KTD8).
 */

import type { ProgressWriteIntent } from "./store"

export const WATCH_PROGRESS_QUEUE_STORAGE_KEY = "watch-progress-queue"
export const WATCH_PROGRESS_QUEUE_VERSION = 1
/** Queue writes are tiny; the ceiling guards a runaway loop, not real use. */
export const WATCH_PROGRESS_QUEUE_MAX_BYTES = 200_000
/** Mirrors the server's per-batch ceiling. */
export const WATCH_PROGRESS_QUEUE_MAX_WRITES = 200

export type ProgressQueue = {
  /** The account whose playback recorded these writes. */
  accountId: string
  writes: ProgressWriteIntent[]
}

function writeKey(write: ProgressWriteIntent): string {
  return write.videoId ? `id:${write.videoId}` : `slug:${write.videoSlug}`
}

/**
 * Enqueue a write, deduping per video (client mirrors server dedupe by the
 * same identity key — keep newest by recordedAt). A write from a different
 * account replaces the whole queue: the old account's pending entries can
 * never legitimately flush again (R7's discard posture).
 */
export function enqueueProgressWrite(
  queue: ProgressQueue | null,
  accountId: string,
  write: ProgressWriteIntent,
): ProgressQueue {
  if (!write.videoId && !write.videoSlug) {
    return queue?.accountId === accountId ? queue : { accountId, writes: [] }
  }
  const base =
    queue != null && queue.accountId === accountId ? queue.writes : []
  const key = writeKey(write)
  const existing = base.find((entry) => writeKey(entry) === key)
  if (existing && existing.recordedAt > write.recordedAt) {
    return { accountId, writes: [...base] }
  }
  const writes = [...base.filter((entry) => writeKey(entry) !== key), write]
  // Over the ceiling, drop the OLDEST-recorded writes first.
  if (writes.length > WATCH_PROGRESS_QUEUE_MAX_WRITES) {
    writes.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    writes.splice(0, writes.length - WATCH_PROGRESS_QUEUE_MAX_WRITES)
  }
  return { accountId, writes }
}

export type FlushDecision =
  | { action: "flush"; writes: ProgressWriteIntent[] }
  | { action: "discard" }
  | { action: "none" }

/**
 * Decide what to do with the queue at flush time: flush only when its
 * account matches the signed-in account; a mismatch (including signed-out)
 * discards (R7/R10). Flush failures keep the queue — the caller clears it
 * only after a successful send.
 */
export function planQueueFlush(
  queue: ProgressQueue | null,
  signedInAccountId: string | null,
): FlushDecision {
  if (queue == null || queue.writes.length === 0) return { action: "none" }
  if (signedInAccountId == null || queue.accountId !== signedInAccountId) {
    return { action: "discard" }
  }
  return { action: "flush", writes: [...queue.writes] }
}

function isValidWrite(value: unknown): value is ProgressWriteIntent {
  if (value == null || typeof value !== "object") return false
  const write = value as Partial<ProgressWriteIntent>
  const hasIdentity =
    (typeof write.videoId === "string" && write.videoId.length > 0) ||
    (typeof write.videoSlug === "string" && write.videoSlug.length > 0)
  return (
    hasIdentity &&
    (write.languageSlug === null || typeof write.languageSlug === "string") &&
    typeof write.positionSeconds === "number" &&
    Number.isFinite(write.positionSeconds) &&
    typeof write.durationSeconds === "number" &&
    Number.isFinite(write.durationSeconds) &&
    typeof write.recordedAt === "string" &&
    write.recordedAt.length > 0
  )
}

/** Degrade-to-null parsing (bad JSON, version drift, wrong shape). */
export function parseStoredProgressQueue(
  raw: string | null,
): ProgressQueue | null {
  if (raw == null) return null
  try {
    const data = JSON.parse(raw) as {
      version?: unknown
      accountId?: unknown
      writes?: unknown
    } | null
    if (data == null || typeof data !== "object") return null
    if (data.version !== WATCH_PROGRESS_QUEUE_VERSION) return null
    if (typeof data.accountId !== "string" || data.accountId.length === 0) {
      return null
    }
    if (!Array.isArray(data.writes)) return null
    const writes = data.writes.filter(isValidWrite)
    if (writes.length === 0) return null
    return { accountId: data.accountId, writes }
  } catch {
    return null
  }
}

/** Null when over the byte ceiling — refuse to write. */
export function serializeProgressQueue(queue: ProgressQueue): string | null {
  const blob = JSON.stringify({
    version: WATCH_PROGRESS_QUEUE_VERSION,
    accountId: queue.accountId,
    writes: queue.writes,
  })
  return blob.length > WATCH_PROGRESS_QUEUE_MAX_BYTES ? null : blob
}
