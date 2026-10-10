import { randomUUID } from "node:crypto"
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { setInterval, clearInterval } from "node:timers"
import { setTimeout as delay } from "node:timers/promises"

import { z } from "zod"

import { devotionalArtifactRoot } from "./artifacts"
import type { JesusFilmChapter } from "./jesus-film-catalog"

export const USED_CLIPS_LEDGER_VERSION = 1
// Human approval can legitimately sit for days. Keep the reservation for a
// month, renew it on status/resume, and release it immediately on reject or
// cancel. This prevents another run from taking the clip while an editor still
// has a rendered video open, without making an abandoned reservation permanent.
export const RESERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000

const LOCK_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 60_000
const LOCK_RETRY_MS = 20
const LOCK_HEARTBEAT_MS = LOCK_STALE_MS / 3

export class UsedClipsLedgerError extends Error {
  override readonly name = "UsedClipsLedgerError"

  constructor(
    readonly code:
      | "empty_pool"
      | "corrupt_ledger"
      | "lock_timeout"
      | "no_available_chapter"
      | "reservation_conflict"
      | "reservation_mismatch",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export type UsedClipEntry = {
  lastUsedAt: string
  count: number
  pendingUntil?: string
  reservationId?: string
}

export type UsedClipsLedger = {
  version: number
  used: Record<string, UsedClipEntry>
}

export type UsedClipReservation = {
  chapter: JesusFilmChapter
  reservationId: string
}

export type UsedClipsStore = {
  read: () => Promise<UsedClipsLedger>
  pick: (
    chapters: ReadonlyArray<JesusFilmChapter>,
  ) => Promise<UsedClipReservation>
  reserve: (chapter: JesusFilmChapter) => Promise<UsedClipReservation>
  record: (
    chapterId: string,
    reservationId: string,
    at?: string,
  ) => Promise<void>
  renew: (chapterId: string, reservationId: string) => Promise<void>
  release: (chapterId: string, reservationId: string) => Promise<boolean>
}

export type CreateUsedClipsStoreOptions = {
  filePath?: string
  now?: () => Date
}

export function emptyLedger(): UsedClipsLedger {
  return { version: USED_CLIPS_LEDGER_VERSION, used: {} }
}

export const UsedClipsLedgerSchema = z
  .object({
    version: z.literal(USED_CLIPS_LEDGER_VERSION),
    used: z.record(
      z.string(),
      z
        .object({
          lastUsedAt: z.string(),
          count: z.number().int().nonnegative(),
          pendingUntil: z.string().optional(),
          reservationId: z.string().uuid().optional(),
        })
        .strict(),
    ),
  })
  .strict()

/**
 * Prefer the lowest never-used chapter, then the least-recently-used chapter.
 * Live reservations are excluded; oversubscription fails instead of sharing a
 * cache and output identity between runs.
 */
export function chooseChapter(
  chapters: ReadonlyArray<JesusFilmChapter>,
  used: Record<string, UsedClipEntry>,
  now: Date = new Date(),
): JesusFilmChapter {
  if (chapters.length === 0) {
    throw new UsedClipsLedgerError(
      "empty_pool",
      "chooseChapter: empty chapter pool",
    )
  }

  const nowMs = now.getTime()
  const available = [...chapters]
    .sort((a, b) => a.index - b.index)
    .filter((chapter) => {
      const pendingUntil = used[chapter.id]?.pendingUntil
      return pendingUntil == null || Date.parse(pendingUntil) <= nowMs
    })

  if (available.length === 0) {
    throw new UsedClipsLedgerError(
      "no_available_chapter",
      "all devotional chapters are currently reserved",
    )
  }

  const neverUsed = available.find(
    (chapter) => (used[chapter.id]?.count ?? 0) === 0,
  )
  if (neverUsed) return neverUsed

  return available.reduce((best, chapter) => {
    const usedAt = used[chapter.id]?.lastUsedAt ?? ""
    const bestUsedAt = used[best.id]?.lastUsedAt ?? ""
    return usedAt < bestUsedAt ? chapter : best
  }, available[0]!)
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
    return UsedClipsLedgerSchema.parse(JSON.parse(raw))
  } catch (cause) {
    throw new UsedClipsLedgerError(
      "corrupt_ledger",
      `used clips ledger is invalid: ${filePath}`,
      { cause },
    )
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
    await writeFile(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8")
    await rename(tmp, filePath)
  } catch (cause) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw cause
  }
}

async function withLedgerLock<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`
  const ownerPath = path.join(lockPath, "owner")
  const owner = randomUUID()
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  await mkdir(path.dirname(filePath), { recursive: true })

  while (true) {
    try {
      await mkdir(lockPath)
      await writeFile(ownerPath, owner, { encoding: "utf8", flag: "wx" })
      break
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause

      try {
        const first = await stat(lockPath)
        if (Date.now() - first.mtimeMs > LOCK_STALE_MS) {
          // Give an active owner's heartbeat a chance to prove liveness. The
          // inode check prevents removing a lock that was released and
          // reacquired while this contender was inspecting it.
          await delay(LOCK_RETRY_MS)
          const second = await stat(lockPath)
          if (
            first.ino === second.ino &&
            first.mtimeMs === second.mtimeMs &&
            Date.now() - second.mtimeMs > LOCK_STALE_MS
          ) {
            const stalePath = `${lockPath}.stale.${randomUUID()}`
            await rename(lockPath, stalePath)
            await rm(stalePath, { recursive: true, force: true })
            continue
          }
        }
      } catch (statCause) {
        if ((statCause as NodeJS.ErrnoException).code === "ENOENT") continue
        throw statCause
      }

      if (Date.now() >= deadline) {
        throw new UsedClipsLedgerError(
          "lock_timeout",
          `timed out waiting for devotional ledger lock ${lockPath}`,
          { cause },
        )
      }
      await delay(LOCK_RETRY_MS)
    }
  }

  const heartbeat = setInterval(() => {
    const at = new Date()
    void utimes(lockPath, at, at).catch(() => undefined)
  }, LOCK_HEARTBEAT_MS)
  heartbeat.unref()

  try {
    return await operation()
  } finally {
    clearInterval(heartbeat)
    const currentOwner = await readFile(ownerPath, "utf8").catch(
      () => undefined,
    )
    if (currentOwner === owner) {
      await rm(lockPath, { recursive: true, force: true }).catch(
        () => undefined,
      )
    }
  }
}

function nextReservation(
  chapter: JesusFilmChapter,
  previous: UsedClipEntry | undefined,
  at: Date,
): { entry: UsedClipEntry; reservationId: string } {
  const reservationId = randomUUID()
  return {
    reservationId,
    entry: {
      lastUsedAt: previous?.lastUsedAt ?? "",
      count: previous?.count ?? 0,
      pendingUntil: new Date(at.getTime() + RESERVATION_TTL_MS).toISOString(),
      reservationId,
    },
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
      return withLedgerLock(filePath, async () => {
        const at = now()
        const ledger = await read()
        const chapter = chooseChapter(chapters, ledger.used, at)
        const reservation = nextReservation(
          chapter,
          ledger.used[chapter.id],
          at,
        )
        ledger.used[chapter.id] = reservation.entry
        await writeLedgerFile(filePath, ledger)
        return { chapter, reservationId: reservation.reservationId }
      })
    },
    async reserve(chapter) {
      return withLedgerLock(filePath, async () => {
        const at = now()
        const ledger = await read()
        const previous = ledger.used[chapter.id]
        if (
          previous?.pendingUntil != null &&
          Date.parse(previous.pendingUntil) > at.getTime()
        ) {
          throw new UsedClipsLedgerError(
            "reservation_conflict",
            `devotional chapter ${chapter.id} is already reserved`,
          )
        }
        const reservation = nextReservation(chapter, previous, at)
        ledger.used[chapter.id] = reservation.entry
        await writeLedgerFile(filePath, ledger)
        return { chapter, reservationId: reservation.reservationId }
      })
    },
    async record(chapterId, reservationId, at) {
      await withLedgerLock(filePath, async () => {
        const ledger = await read()
        const previous = ledger.used[chapterId]
        if (!previous || previous.reservationId !== reservationId) {
          throw new UsedClipsLedgerError(
            "reservation_mismatch",
            `reservation ${reservationId} does not own devotional chapter ${chapterId}`,
          )
        }
        ledger.used[chapterId] = {
          lastUsedAt: at ?? now().toISOString(),
          count: previous.count + 1,
        }
        await writeLedgerFile(filePath, ledger)
      })
    },
    async renew(chapterId, reservationId) {
      await withLedgerLock(filePath, async () => {
        const at = now()
        const ledger = await read()
        const previous = ledger.used[chapterId]
        if (!previous || previous.reservationId !== reservationId) {
          throw new UsedClipsLedgerError(
            "reservation_mismatch",
            `reservation ${reservationId} does not own devotional chapter ${chapterId}`,
          )
        }
        if (
          previous.pendingUntil &&
          Date.parse(previous.pendingUntil) - at.getTime() >=
            RESERVATION_TTL_MS / 2
        ) {
          return
        }
        ledger.used[chapterId] = {
          ...previous,
          pendingUntil: new Date(
            at.getTime() + RESERVATION_TTL_MS,
          ).toISOString(),
        }
        await writeLedgerFile(filePath, ledger)
      })
    },
    async release(chapterId, reservationId) {
      return withLedgerLock(filePath, async () => {
        const ledger = await read()
        const previous = ledger.used[chapterId]
        if (
          !previous?.pendingUntil ||
          previous.reservationId !== reservationId
        ) {
          return false
        }
        ledger.used[chapterId] = {
          lastUsedAt: previous.lastUsedAt,
          count: previous.count,
        }
        await writeLedgerFile(filePath, ledger)
        return true
      })
    },
  }
}
