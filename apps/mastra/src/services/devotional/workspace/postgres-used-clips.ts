import { randomUUID } from "node:crypto"

import type { JesusFilmChapter } from "../jesus-film-catalog"
import {
  RESERVATION_TTL_MS,
  USED_CLIPS_LEDGER_VERSION,
  UsedClipsLedgerError,
  chooseChapter,
  type UsedClipEntry,
  type UsedClipsLedger,
  type UsedClipsStore,
} from "../used-clips-ledger"
import { getDevotionalDatabase, type DevotionalDatabase } from "./database"

type ClipRow = {
  chapter_id: string
  use_count: number
  last_used_at: Date | string | null
  reservation_id: string | null
  pending_until: Date | string | null
}

function toIso(value: Date | string | null): string | undefined {
  if (value == null) return undefined
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function entryFromRow(row: ClipRow): UsedClipEntry {
  return {
    count: row.use_count,
    lastUsedAt: toIso(row.last_used_at) ?? "",
    ...(row.reservation_id ? { reservationId: row.reservation_id } : {}),
    ...(row.pending_until ? { pendingUntil: toIso(row.pending_until) } : {}),
  }
}

async function readLedger(
  database: Pick<DevotionalDatabase, "query">,
): Promise<UsedClipsLedger> {
  const result = await database.query<ClipRow>(
    `SELECT chapter_id, use_count, last_used_at, reservation_id, pending_until
       FROM devotional_workspace.clip_state
      ORDER BY chapter_id`,
  )
  return {
    version: USED_CLIPS_LEDGER_VERSION,
    used: Object.fromEntries(
      result.rows.map((row) => [row.chapter_id, entryFromRow(row)]),
    ),
  }
}

async function reserveChapter(options: {
  database: DevotionalDatabase
  chapter: JesusFilmChapter
  now: Date
}): Promise<{ chapter: JesusFilmChapter; reservationId: string }> {
  const reservationId = randomUUID()
  const pendingUntil = new Date(
    options.now.getTime() + RESERVATION_TTL_MS,
  ).toISOString()
  const result = await options.database.query(
    `INSERT INTO devotional_workspace.clip_state
       (chapter_id, reservation_id, pending_until, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (chapter_id) DO UPDATE
       SET reservation_id = excluded.reservation_id,
           pending_until = excluded.pending_until,
           updated_at = now()
     WHERE devotional_workspace.clip_state.pending_until IS NULL
        OR devotional_workspace.clip_state.pending_until <= $4
     RETURNING chapter_id`,
    [
      options.chapter.id,
      reservationId,
      pendingUntil,
      options.now.toISOString(),
    ],
  )
  if (result.rowCount !== 1) {
    throw new UsedClipsLedgerError(
      "reservation_conflict",
      `devotional chapter ${options.chapter.id} is already reserved`,
    )
  }
  return { chapter: options.chapter, reservationId }
}

export function createPostgresUsedClipsStore(
  options: {
    database?: DevotionalDatabase
    now?: () => Date
  } = {},
): UsedClipsStore {
  const database = options.database ?? getDevotionalDatabase()
  const now = options.now ?? (() => new Date())
  return {
    read: () => readLedger(database),
    pick: (chapters) =>
      database.transaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('devotional-clip-state'))",
        )
        const at = now()
        const ledger = await readLedger(client as DevotionalDatabase)
        const chapter = chooseChapter(chapters, ledger.used, at)
        return reserveChapter({
          database: client as DevotionalDatabase,
          chapter,
          now: at,
        })
      }),
    reserve: (chapter) => reserveChapter({ database, chapter, now: now() }),
    async record(chapterId, reservationId, at = now().toISOString()) {
      const result = await database.query(
        `UPDATE devotional_workspace.clip_state
            SET use_count = use_count + 1, last_used_at = $3,
                reservation_id = NULL, pending_until = NULL, updated_at = now()
          WHERE chapter_id = $1 AND reservation_id = $2`,
        [chapterId, reservationId, at],
      )
      if (result.rowCount !== 1) {
        throw new UsedClipsLedgerError(
          "reservation_mismatch",
          `reservation ${reservationId} does not own devotional chapter ${chapterId}`,
        )
      }
    },
    async renew(chapterId, reservationId) {
      const result = await database.query(
        `UPDATE devotional_workspace.clip_state
            SET pending_until = $3, updated_at = now()
          WHERE chapter_id = $1 AND reservation_id = $2`,
        [
          chapterId,
          reservationId,
          new Date(now().getTime() + RESERVATION_TTL_MS).toISOString(),
        ],
      )
      if (result.rowCount !== 1) {
        throw new UsedClipsLedgerError(
          "reservation_mismatch",
          `reservation ${reservationId} does not own devotional chapter ${chapterId}`,
        )
      }
    },
    async release(chapterId, reservationId) {
      const result = await database.query(
        `UPDATE devotional_workspace.clip_state
            SET reservation_id = NULL, pending_until = NULL, updated_at = now()
          WHERE chapter_id = $1 AND reservation_id = $2`,
        [chapterId, reservationId],
      )
      return result.rowCount === 1
    },
  }
}

let postgresUsedClipsStore: UsedClipsStore | undefined

export function getPostgresUsedClipsStore(): UsedClipsStore {
  postgresUsedClipsStore ??= createPostgresUsedClipsStore()
  return postgresUsedClipsStore
}
