/**
 * Clip windows (KTD24): the eligible-start list for one track and record
 * version, the sentence-cut picker (R26, R27, R29), and the fallback (R23).
 */

import type { ClipTiming, SentenceEnd } from "./sentenceTiming"
import type { ClipWindow } from "./types"

/**
 * R27: a clip's sentence end is from 30 s to 60 s after its start. The owner
 * raised the minimum from 10 s on 2026-09-27.
 */
export const MIN_CLIP_SECONDS = 30
export const MAX_CLIP_SECONDS = 60

/** R23: a fallback clip is 30 s long, and a shorter video gives no clip. */
export const FALLBACK_CLIP_SECONDS = 30
export const MIN_CLIP_VIDEO_SECONDS = MIN_CLIP_SECONDS
const FALLBACK_START_MIN_FRACTION = 0.05
const FALLBACK_START_MAX_FRACTION = 0.8

/** Returns a number from 0 (inclusive) to 1 (exclusive). Tests seed it. */
export type RandomSource = () => number

/** A sentence-cut window. `preferred` marks a start after a pause. */
export type EligibleStart = ClipWindow & { preferred: boolean }

/** The record as the engine reads it: one video's windows, and the version. */
export type RecordSnapshot = {
  version: number
  windows: readonly ClipWindow[]
}

export type MemoSlot<T> = {
  get: () => T | undefined
  set: (value: T) => void
}

export type EligibleStartsMemo = {
  recordVersion: number
  starts: readonly EligibleStart[]
}

/** Sorted and disjoint. A bad window is dropped, not trusted. */
function mergeWindows(windows: readonly ClipWindow[]): ClipWindow[] {
  const sorted = windows
    .filter(
      (w) =>
        Number.isFinite(w.startSeconds) &&
        Number.isFinite(w.endSeconds) &&
        w.endSeconds > w.startSeconds,
    )
    .sort((a, b) => a.startSeconds - b.startSeconds)
  const merged: ClipWindow[] = []
  for (const w of sorted) {
    const last = merged[merged.length - 1]
    if (last && w.startSeconds <= last.endSeconds) {
      if (w.endSeconds > last.endSeconds) last.endSeconds = w.endSeconds
    } else {
      merged.push({ startSeconds: w.startSeconds, endSeconds: w.endSeconds })
    }
  }
  return merged
}

/** The first index in [0, length) where `isPast` turns true, or `length`. */
function firstIndex(length: number, isPast: (index: number) => boolean) {
  let low = 0
  let high = length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (isPast(mid)) high = mid
    else low = mid + 1
  }
  return low
}

/**
 * Every start that R26–R29 allow, each with its R27 window. A start inside a
 * recorded window is left out, and an end must not reach the next one.
 */
export function buildEligibleStarts(
  timing: ClipTiming,
  recorded: readonly ClipWindow[],
): EligibleStart[] {
  const { starts, ends } = timing
  const records = mergeWindows(recorded)
  // nextLongPause[i]: the first end at or after i that a long pause follows.
  const nextLongPause = new Array<number>(ends.length + 1)
  nextLongPause[ends.length] = ends.length
  for (let i = ends.length - 1; i >= 0; i--) {
    nextLongPause[i] = ends[i].longPause ? i : nextLongPause[i + 1]
  }

  const eligible: EligibleStart[] = []
  let r = 0
  for (const start of starts) {
    const s = start.time
    while (r < records.length && records[r].endSeconds <= s) r++
    if (r < records.length && records[r].startSeconds <= s) continue
    const limit = r < records.length ? records[r].startSeconds : Infinity

    const low = firstIndex(
      ends.length,
      (i) => ends[i].cueEnd >= s + MIN_CLIP_SECONDS,
    )
    const high =
      Math.min(
        firstIndex(ends.length, (i) => ends[i].cueEnd > s + MAX_CLIP_SECONDS),
        firstIndex(ends.length, (i) => ends[i].switchTime > limit),
      ) - 1
    if (low > high) continue

    const end: SentenceEnd =
      nextLongPause[low] <= high ? ends[nextLongPause[low]] : ends[high]
    eligible.push({
      startSeconds: s,
      endSeconds: end.switchTime,
      preferred: start.preferred,
    })
  }
  return eligible
}

/** Builds the list once per record version. Give it one slot per track and video. */
export function eligibleStartsOnce(
  slot: MemoSlot<EligibleStartsMemo>,
  timing: ClipTiming,
  record: RecordSnapshot,
): readonly EligibleStart[] {
  const held = slot.get()
  if (held && held.recordVersion === record.version) return held.starts
  const starts = buildEligibleStarts(timing, record.windows)
  slot.set({ recordVersion: record.version, starts })
  return starts
}

/** The source's value, or 0 when it answers outside [0, 1). */
export function unitRandom(random: RandomSource): number {
  const value = random()
  return value >= 0 && value < 1 ? value : 0
}

/** True when two windows share time. Windows that only touch do not. */
export function overlaps(a: ClipWindow, b: ClipWindow): boolean {
  return a.startSeconds < b.endSeconds && b.startSeconds < a.endSeconds
}

/**
 * R26: a random eligible start, from the starts after a pause while any is
 * left. Null means no window: the queue releases old records (R31) or moves on.
 */
export function pickSentenceWindow(
  eligible: readonly EligibleStart[],
  random: RandomSource,
): ClipWindow | null {
  if (eligible.length === 0) return null
  const preferred = eligible.filter((w) => w.preferred)
  const pool = preferred.length > 0 ? preferred : eligible
  const index = Math.min(
    pool.length - 1,
    Math.floor(unitRandom(random) * pool.length),
  )
  const { startSeconds, endSeconds } = pool[index]
  return { startSeconds, endSeconds }
}

/**
 * R23 for a video with no usable sentence timing, outside the record (R29).
 * The start range stops 30 s before the end. When it is empty (under ~31.6 s),
 * a video of 30 s or more plays whole.
 */
export function fallbackWindow(
  durationSeconds: number,
  recorded: readonly ClipWindow[],
  random: RandomSource,
): ClipWindow | null {
  if (!Number.isFinite(durationSeconds)) return null
  if (durationSeconds < MIN_CLIP_VIDEO_SECONDS) return null
  const records = mergeWindows(recorded)
  const first = durationSeconds * FALLBACK_START_MIN_FRACTION
  const last = Math.min(
    durationSeconds * FALLBACK_START_MAX_FRACTION,
    durationSeconds - FALLBACK_CLIP_SECONDS,
  )

  if (last < first) {
    const blocked = records.some(
      (w) => w.startSeconds < durationSeconds && w.endSeconds > 0,
    )
    return blocked ? null : { startSeconds: 0, endSeconds: durationSeconds }
  }

  // A start in (recorded start - 30 s, recorded end) would overlap it.
  const free: Array<[number, number]> = []
  let cursor = first
  for (const w of records) {
    const blockedFrom = w.startSeconds - FALLBACK_CLIP_SECONDS
    if (blockedFrom > last) break
    if (blockedFrom >= cursor) free.push([cursor, blockedFrom])
    if (w.endSeconds > cursor) cursor = w.endSeconds
  }
  if (cursor <= last) free.push([cursor, last])
  if (free.length === 0) return null

  const total = free.reduce((sum, [a, b]) => sum + (b - a), 0)
  let start: number
  if (total > 0) {
    let offset = unitRandom(random) * total
    start = free[free.length - 1][1]
    for (const [a, b] of free) {
      if (offset < b - a) {
        start = a + offset
        break
      }
      offset -= b - a
    }
  } else {
    // Only single points are free: each is a window that fits exactly.
    const index = Math.min(
      free.length - 1,
      Math.floor(unitRandom(random) * free.length),
    )
    start = free[index][0]
  }
  return { startSeconds: start, endSeconds: start + FALLBACK_CLIP_SECONDS }
}
