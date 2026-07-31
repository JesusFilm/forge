// DB-backed sync lock — atomic UPDATE WHERE unlocked or stale.
//
// Replaces the CMS's in-memory `syncInProgress` guard which does not
// survive Railway horizontal scaling.

import type { Prisma, PrismaClient } from "@prisma/client"

const LOCK_KEY = "core-sync"
export const DEFAULT_SYNC_LOCK_STALE_AFTER_MS = 15 * 60 * 1000

export class SyncLockFenceError extends Error {
  constructor() {
    super("Core sync lock ownership or lease was lost")
    this.name = "SyncLockFenceError"
  }
}

/**
 * Locks the ownership row for the remainder of the caller's transaction and
 * verifies both holder identity and lease freshness in the database clock.
 */
export async function assertSyncLockHeld(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  heldBy: string,
  staleAfterMs = DEFAULT_SYNC_LOCK_STALE_AFTER_MS,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ heldBy: string }>>`
    SELECT held_by AS "heldBy"
    FROM sync_locks
    WHERE key = ${LOCK_KEY}
      AND held_by = ${heldBy}
      AND updated_at >= NOW() - (${staleAfterMs} * INTERVAL '1 millisecond')
    FOR UPDATE
  `

  if (rows.length !== 1 || rows[0]?.heldBy !== heldBy) {
    throw new SyncLockFenceError()
  }
}

export async function acquireSyncLock(
  prisma: PrismaClient,
  heldBy: string,
  staleAfterMs = DEFAULT_SYNC_LOCK_STALE_AFTER_MS,
): Promise<boolean> {
  // Ensure the lock row exists (idempotent)
  await prisma.syncLock.upsert({
    where: { key: LOCK_KEY },
    create: { key: LOCK_KEY },
    update: {},
  })

  // Atomic claim: UPDATE only if not held, or if the holder stopped
  // heartbeating and the row is stale. Returns affected count.
  const claimed = await prisma.$executeRaw`
    UPDATE sync_locks
    SET held_by = ${heldBy}, acquired_at = NOW(), updated_at = NOW()
    WHERE key = ${LOCK_KEY}
      AND (
        held_by IS NULL
        OR updated_at < NOW() - (${staleAfterMs} * INTERVAL '1 millisecond')
      )
  `

  return claimed > 0
}

export async function refreshSyncLock(
  prisma: PrismaClient,
  heldBy: string,
): Promise<boolean> {
  const refreshed = await prisma.$executeRaw`
    UPDATE sync_locks
    SET updated_at = NOW()
    WHERE key = ${LOCK_KEY} AND held_by = ${heldBy}
  `

  return refreshed > 0
}

export async function releaseSyncLock(
  prisma: PrismaClient,
  heldBy: string,
): Promise<boolean> {
  const released = await prisma.$executeRaw`
    UPDATE sync_locks
    SET held_by = NULL, acquired_at = NULL, updated_at = NOW()
    WHERE key = ${LOCK_KEY} AND held_by = ${heldBy}
  `

  return released > 0
}
