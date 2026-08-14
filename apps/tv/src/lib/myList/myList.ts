// My List — the viewer's self-curated watchlist. Local-first and keyed per
// install, exactly like the Continue Watching shelf it sits beside on Home:
// one anonymous bucket, promoted into whichever account signs in (see
// anonymousMerge.ts rule 2 — there are deliberately NO per-user local buckets).
//
// Same conventions as continueWatching.ts: pure decision functions (apps/tv has
// no render harness), safeStorage I/O, best-effort, own promise-chain lock.

import { getStorage } from "../safeStorage"

export const MY_LIST_STORAGE_KEY = "forge.watch.my_list"
/** Generous next to the 10-card resume shelf — a watchlist is meant to
 *  accumulate — but still bounded, since the whole list is one JSON blob. */
export const MAX_MY_LIST = 50

export type MyListEntry = {
  /** Admin Video documentId — the dedupe key, and what the account row keys on. */
  videoId: string
  /** Public slug for routing. */
  slug: string
  title: string | null
  /** 16:9 cinematic for the rail card. */
  imageUrl: string | null
  /**
   * The RAW admin label, in admin's own spelling (`"SERIES"`, `"COLLECTION"`,
   * `"EPISODE"`, `"FEATURE_FILM"`, …). Stored rather than a local boolean
   * because routing runs it back through `isSeriesLabel`, which matches STRICT
   * UPPERCASE — a re-spelled or lower-cased label silently routes a saved
   * series to /watch, where it has no player.
   */
  rawLabel: string | null
  /** ISO stamp; the list renders newest-first on this. */
  addedAt: string
}

// ── Pure decision layer ─────────────────────────────────────────────────────

/** Defensive parse; malformed payloads and entries are dropped. */
export function parseMyList(raw: string | null): MyListEntry[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is MyListEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as { videoId?: unknown }).videoId === "string" &&
          typeof (e as { slug?: unknown }).slug === "string" &&
          typeof (e as { addedAt?: unknown }).addedAt === "string",
      )
      .slice(0, MAX_MY_LIST)
  } catch {
    return []
  }
}

/** True when this video is already saved. */
export function containsEntry(
  entries: readonly MyListEntry[],
  videoId: string,
): boolean {
  return entries.some((e) => e.videoId === videoId)
}

/**
 * Add to the front, replacing any existing row for the same video.
 *
 * Re-adding something already saved MOVES it to the front rather than
 * duplicating it — the list is a set keyed on videoId, and the freshest
 * display fields win (a title or image that changed upstream should not be
 * pinned to whatever was cached the first time).
 */
export function applyAdd(
  entries: readonly MyListEntry[],
  entry: MyListEntry,
): MyListEntry[] {
  const others = entries.filter((e) => e.videoId !== entry.videoId)
  return [entry, ...others].slice(0, MAX_MY_LIST)
}

export function applyRemove(
  entries: readonly MyListEntry[],
  videoId: string,
): MyListEntry[] {
  return entries.filter((e) => e.videoId !== videoId)
}

// ── Storage layer (best-effort; failures never break the screen) ────────────

let listLock: Promise<unknown> = Promise.resolve()
function withListLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = listLock.then(fn, fn)
  listLock = run.catch(() => undefined)
  return run
}

/** Reads take the same lock as writes, so a screen re-reading right after a
 *  toggle sees the toggle, not the state from before it (the unlocked-read
 *  race continueWatching.ts documents). */
export async function loadMyList(): Promise<MyListEntry[]> {
  return withListLock(async () => {
    try {
      return parseMyList(await getStorage().getItem(MY_LIST_STORAGE_KEY))
    } catch {
      return []
    }
  })
}

/** Whether one video is saved. */
export async function isInMyList(videoId: string): Promise<boolean> {
  return containsEntry(await loadMyList(), videoId)
}

// Callee helper — runs INSIDE the list lock only (no locking of its own).
async function writeLocked(entries: readonly MyListEntry[]): Promise<void> {
  const storage = getStorage()
  if (entries.length === 0) {
    await storage.removeItem(MY_LIST_STORAGE_KEY)
    return
  }
  await storage.setItem(MY_LIST_STORAGE_KEY, JSON.stringify(entries))
}

export async function addToMyList(entry: MyListEntry): Promise<void> {
  await withListLock(async () => {
    try {
      const storage = getStorage()
      await writeLocked(
        applyAdd(
          parseMyList(await storage.getItem(MY_LIST_STORAGE_KEY)),
          entry,
        ),
      )
    } catch {
      // Best-effort only.
    }
  })
}

export async function removeFromMyList(videoId: string): Promise<void> {
  await withListLock(async () => {
    try {
      const storage = getStorage()
      await writeLocked(
        applyRemove(
          parseMyList(await storage.getItem(MY_LIST_STORAGE_KEY)),
          videoId,
        ),
      )
    } catch {
      // Best-effort only.
    }
  })
}

/**
 * Flip membership for one video and report the state the viewer now sees.
 *
 * Read-decide-write happens inside ONE lock hold: the details-page toggle is a
 * button a viewer can hammer, and a read outside the lock would let two presses
 * both observe "not saved" and both add.
 *
 * Returns whether the video is saved after the toggle, so the caller can paint
 * from the persisted truth instead of assuming its optimistic guess landed. A
 * storage failure reports the UNCHANGED state — the button must not claim a
 * save that did not happen.
 */
export async function toggleMyList(entry: MyListEntry): Promise<boolean> {
  return withListLock(async () => {
    try {
      const storage = getStorage()
      const current = parseMyList(await storage.getItem(MY_LIST_STORAGE_KEY))
      const wasSaved = containsEntry(current, entry.videoId)
      await writeLocked(
        wasSaved
          ? applyRemove(current, entry.videoId)
          : applyAdd(current, entry),
      )
      return !wasSaved
    } catch {
      return false
    }
  })
}

/**
 * Erase the list, inside the lock.
 *
 * Sign-out calls this through `clearAnonymousWatchState`. The lock is the point:
 * a bare `removeItem` can land mid-`toggleMyList`, whose pending write then
 * re-materializes the list that was just erased — handing the previous viewer's
 * saved titles to the next person on a shared TV. Returns whether the list is
 * confirmed gone so callers can fail closed.
 */
export async function clearMyList(): Promise<boolean> {
  return withListLock(async () => {
    try {
      await getStorage().removeItem(MY_LIST_STORAGE_KEY)
      return true
    } catch {
      return false
    }
  })
}

/**
 * Locked read-modify-write over the WHOLE list, for bulk folds (the account
 * hydrate). `mutate` must be pure; it runs inside the lock so a concurrent
 * toggle cannot interleave between the read and the write. Re-capped
 * defensively.
 */
export async function updateMyList(
  mutate: (entries: MyListEntry[]) => MyListEntry[],
): Promise<void> {
  await withListLock(async () => {
    try {
      const storage = getStorage()
      const next = mutate(
        parseMyList(await storage.getItem(MY_LIST_STORAGE_KEY)),
      ).slice(0, MAX_MY_LIST)
      await writeLocked(next)
    } catch {
      // Best-effort only.
    }
  })
}
