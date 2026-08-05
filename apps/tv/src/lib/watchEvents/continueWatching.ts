// Anonymous Continue Watching store (feat-322) — the resume half of the local
// watch-data pair (watchEvents.ts holds the analytics queue). One entry per
// video: the LATEST playback position plus the display fields the Home rail
// needs to render a card without a network fetch. Local-only until sign-in;
// the store is keyed per install, not per account.
//
// Same conventions as watchEvents.ts: pure decision functions (no render
// harness in apps/tv), safeStorage I/O, best-effort, own promise-chain lock.

import { getStorage } from "../safeStorage"

export const CONTINUE_WATCHING_STORAGE_KEY = "forge.watch.continue_watching"
/** Netflix-ish: a modest shelf, most recent first. */
export const MAX_CONTINUE_WATCHING = 10
/** Below this, a card is noise (accidental plays): 30s watched OR 25%. */
export const RESUME_MIN_SECONDS = 30
export const RESUME_MIN_PROGRESS = 0.25
/** At/after this fraction the video counts as finished and the entry drops. */
export const RESUME_FINISHED_PROGRESS = 0.95

export type ContinueWatchingEntry = {
  /** Admin Video documentId — the upsert key. */
  videoId: string
  /** Public slug for routing to /watch/[slug]. */
  slug: string
  title: string | null
  /** 16:9 cinematic for the rail card. */
  imageUrl: string | null
  /** Mux playback id, so the shelf card can animate a hover preview anchored
   *  at the resume point. Null when the video has no Mux asset. */
  playbackId?: string | null
  positionSeconds: number
  durationSeconds: number | null
  /** 0..1 when duration known. */
  progress: number | null
  updatedAt: string
}

export type ResumeSnapshot = {
  positionSeconds: number
  durationSeconds: number | null
}

// ── Pure decision layer ─────────────────────────────────────────────────────

/** Watched enough to shelve, and not effectively finished. */
export function isResumeWorthy(snapshot: ResumeSnapshot): boolean {
  const { positionSeconds, durationSeconds } = snapshot
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return false
  const progress =
    durationSeconds != null && durationSeconds > 0
      ? positionSeconds / durationSeconds
      : null
  if (progress != null && progress >= RESUME_FINISHED_PROGRESS) return false
  return (
    positionSeconds >= RESUME_MIN_SECONDS ||
    (progress != null && progress >= RESUME_MIN_PROGRESS)
  )
}

/** True when the snapshot means "watched to the end" — drop the entry. */
export function isFinished(snapshot: ResumeSnapshot): boolean {
  const { positionSeconds, durationSeconds } = snapshot
  return (
    durationSeconds != null &&
    durationSeconds > 0 &&
    positionSeconds / durationSeconds >= RESUME_FINISHED_PROGRESS
  )
}

/**
 * Apply one playback snapshot to the shelf: upsert (most recent first, capped)
 * when resume-worthy, REMOVE when finished, no-op below the noise floor
 * (an existing entry survives a sub-threshold snapshot — backing out at 5s
 * must not erase yesterday's 40-minute position).
 */
export function applyResumeSnapshot(
  entries: readonly ContinueWatchingEntry[],
  entry: Omit<
    ContinueWatchingEntry,
    "positionSeconds" | "durationSeconds" | "progress"
  >,
  snapshot: ResumeSnapshot,
): ContinueWatchingEntry[] {
  const others = entries.filter((e) => e.videoId !== entry.videoId)
  if (isFinished(snapshot)) return others
  if (!isResumeWorthy(snapshot)) return [...entries]
  const duration =
    snapshot.durationSeconds != null &&
    Number.isFinite(snapshot.durationSeconds) &&
    snapshot.durationSeconds > 0
      ? Math.floor(snapshot.durationSeconds)
      : null
  const position = Math.floor(snapshot.positionSeconds)
  const next: ContinueWatchingEntry = {
    ...entry,
    positionSeconds: position,
    durationSeconds: duration,
    progress:
      duration != null
        ? snapshot.positionSeconds / snapshot.durationSeconds!
        : null,
  }
  return [next, ...others].slice(0, MAX_CONTINUE_WATCHING)
}

/** Defensive parse; malformed payloads and entries are dropped. */
export function parseContinueWatching(
  raw: string | null,
): ContinueWatchingEntry[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is ContinueWatchingEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { videoId?: unknown }).videoId === "string" &&
          typeof (e as { slug?: unknown }).slug === "string" &&
          typeof (e as { positionSeconds?: unknown }).positionSeconds ===
            "number" &&
          typeof (e as { updatedAt?: unknown }).updatedAt === "string",
      )
      .slice(0, MAX_CONTINUE_WATCHING)
  } catch {
    return []
  }
}

// ── Storage layer (best-effort; failures never break playback) ──────────────

let shelfLock: Promise<unknown> = Promise.resolve()
function withShelfLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = shelfLock.then(fn, fn)
  shelfLock = run.catch(() => undefined)
  return run
}

/** Reads go through the same lock as writes: the overlay-close resume reload
 *  and the Home shelf load must see a just-queued exit save, not the state
 *  from before it (review P2 — unlocked reads deterministically raced the
 *  final unmount write). */
export async function loadContinueWatching(): Promise<ContinueWatchingEntry[]> {
  return withShelfLock(async () => {
    try {
      return parseContinueWatching(
        await getStorage().getItem(CONTINUE_WATCHING_STORAGE_KEY),
      )
    } catch {
      return []
    }
  })
}

/** Record a playback snapshot for a video. Fire-and-forget; never throws. */
export async function saveResumeSnapshot(
  entry: Omit<
    ContinueWatchingEntry,
    "positionSeconds" | "durationSeconds" | "progress"
  >,
  snapshot: ResumeSnapshot,
): Promise<void> {
  await withShelfLock(async () => {
    try {
      const storage = getStorage()
      const next = applyResumeSnapshot(
        parseContinueWatching(
          await storage.getItem(CONTINUE_WATCHING_STORAGE_KEY),
        ),
        entry,
        snapshot,
      )
      if (next.length === 0) {
        await storage.removeItem(CONTINUE_WATCHING_STORAGE_KEY)
        return
      }
      await storage.setItem(CONTINUE_WATCHING_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Best-effort only.
    }
  })
}

/** The saved resume position for one video, or null. */
export async function getResumePosition(
  videoId: string,
): Promise<number | null> {
  const entries = await loadContinueWatching()
  const entry = entries.find((e) => e.videoId === videoId)
  return entry ? entry.positionSeconds : null
}
