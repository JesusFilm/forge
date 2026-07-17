import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { devotionalArtifactRoot } from "./artifacts"
import type { JesusFilmChapter } from "./jesus-film-catalog"

/**
 * "Used clips" ledger for the video-first devotional pipeline.
 *
 * The pipeline picks a JESUS-film chapter FIRST, then builds the scripture and
 * devotional around it — so we must not reuse a clip we've already shipped
 * (feat intent: "we don't want to repeat videos"). This ledger records which
 * chapters have been used and when, and chooses the next clip.
 *
 * Selection policy: **prefer a never-used chapter** (lowest index first, so the
 * film is worked through in order); when every chapter has been used at least
 * once, fall back to the **least-recently-used** (oldest `lastUsedAt`), so a
 * year of daily devotionals degrades gracefully instead of running dry.
 *
 * Pure selection (`chooseChapter`) is separated from IO so it is trivially
 * testable; the store wraps it with atomic JSON persistence.
 */

export const USED_CLIPS_LEDGER_VERSION = 1

/**
 * How long a `pick` reservation holds a chapter before it self-heals. Covers the
 * render + human-approval span; if a run crashes without recording OR releasing,
 * the reservation expires so the clip is never lost forever.
 */
export const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000

export type UsedClipEntry = {
  /** ISO timestamp of the most recent use. */
  lastUsedAt: string
  /** How many times this chapter has been used. */
  count: number
  /**
   * ISO timestamp until which an in-flight run has claimed this chapter. While
   * live (in the future) `chooseChapter` skips it, so two concurrent runs pick
   * DISTINCT chapters instead of colliding on one cache dir and double-recording
   * at publish. Cleared by `record` (approved) or `release` (rejected/blocked).
   */
  pendingUntil?: string
}

export type UsedClipsLedger = {
  version: number
  /** chapterId -> usage. */
  used: Record<string, UsedClipEntry>
}

export function emptyLedger(): UsedClipsLedger {
  return { version: USED_CLIPS_LEDGER_VERSION, used: {} }
}

/**
 * Choose the next chapter given current usage. Never-used chapters win (by
 * ascending index); otherwise the least-recently-used chapter wins, with the
 * lowest index breaking ties deterministically. Throws only on an empty pool.
 */
export function chooseChapter(
  chapters: ReadonlyArray<JesusFilmChapter>,
  used: Record<string, UsedClipEntry>,
  now: Date = new Date(),
): JesusFilmChapter {
  if (chapters.length === 0) {
    throw new Error("chooseChapter: empty chapter pool")
  }
  const byIndex = [...chapters].sort((a, b) => a.index - b.index)

  // Skip chapters a live run has reserved. If EVERY chapter is reserved (extreme
  // — more concurrent runs than chapters), ignore reservations rather than fail.
  const nowMs = now.getTime()
  const isReserved = (id: string): boolean => {
    const until = used[id]?.pendingUntil
    return until != null && Date.parse(until) > nowMs
  }
  const available = byIndex.filter((c) => !isReserved(c.id))
  const pool = available.length > 0 ? available : byIndex

  // A chapter is "never used" when it has no recorded uses (an expired-
  // reservation entry has count 0, so it still counts as never-used here).
  const neverUsed = pool.find((c) => (used[c.id]?.count ?? 0) === 0)
  if (neverUsed) return neverUsed

  // All used at least once → least-recently-used, ties → lowest index.
  return pool.reduce((best, c) => {
    const t = used[c.id]?.lastUsedAt ?? ""
    const bestT = used[best.id]?.lastUsedAt ?? ""
    if (t < bestT) return c
    return best
  }, pool[0])
}

export type UsedClipsStore = {
  read: () => Promise<UsedClipsLedger>
  /**
   * Choose the next chapter AND atomically reserve it (so a concurrent pick gets
   * a different one). Commit with `record` on success, or `release` on
   * rejection; an abandoned reservation self-heals after RESERVATION_TTL_MS.
   */
  pick: (chapters: ReadonlyArray<JesusFilmChapter>) => Promise<JesusFilmChapter>
  /** Record a chapter as used at `at` (defaults to now); clears its reservation. */
  record: (chapterId: string, at?: string) => Promise<void>
  /** Drop a reservation without recording a use (rejected/blocked run). */
  release: (chapterId: string) => Promise<void>
}

export type CreateUsedClipsStoreOptions = {
  /** Ledger file path; defaults to `<artifactRoot>/used-clips.json`. */
  filePath?: string
  now?: () => Date
}

export function usedClipsLedgerPath(): string {
  return path.join(devotionalArtifactRoot(), "used-clips.json")
}

async function readLedgerFile(filePath: string): Promise<UsedClipsLedger> {
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger()
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Partial<UsedClipsLedger>
    return {
      version: parsed.version ?? USED_CLIPS_LEDGER_VERSION,
      used: parsed.used ?? {},
    }
  } catch {
    // Corrupt ledger must not brick the run — treat as empty (worst case a
    // clip repeats once). The atomic write below then heals the file.
    return emptyLedger()
  }
}

async function writeLedgerFile(
  filePath: string,
  ledger: UsedClipsLedger,
): Promise<void> {
  const dir = path.dirname(filePath)
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf8")
    await rename(tmp, filePath)
  } catch (cause) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw cause
  }
}

export function createUsedClipsStore(
  options: CreateUsedClipsStoreOptions = {},
): UsedClipsStore {
  const filePath = options.filePath ?? usedClipsLedgerPath()
  const now = options.now ?? (() => new Date())

  const read = () => readLedgerFile(filePath)

  return {
    read,
    async pick(chapters) {
      const at = now()
      const ledger = await read()
      const chosen = chooseChapter(chapters, ledger.used, at)
      // Reserve it so a concurrent run picks a different chapter. Within one
      // process the read→write is sequential (no interleave); across processes
      // a narrow TOCTOU remains — acceptable for the single daily cron, and it
      // still self-heals via the TTL.
      const prev = ledger.used[chosen.id]
      ledger.used[chosen.id] = {
        lastUsedAt: prev?.lastUsedAt ?? "",
        count: prev?.count ?? 0,
        pendingUntil: new Date(at.getTime() + RESERVATION_TTL_MS).toISOString(),
      }
      await writeLedgerFile(filePath, ledger)
      return chosen
    },
    async record(chapterId, at) {
      const ledger = await read()
      const when = at ?? now().toISOString()
      const prev = ledger.used[chapterId]
      ledger.used[chapterId] = {
        lastUsedAt: when,
        count: (prev?.count ?? 0) + 1,
        // reservation committed → clear pendingUntil (omitted).
      }
      await writeLedgerFile(filePath, ledger)
    },
    async release(chapterId) {
      const ledger = await read()
      const prev = ledger.used[chapterId]
      if (!prev?.pendingUntil) return
      ledger.used[chapterId] = {
        lastUsedAt: prev.lastUsedAt,
        count: prev.count,
      }
      await writeLedgerFile(filePath, ledger)
    },
  }
}
