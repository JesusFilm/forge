// DB-backed sync lock — claimed via SELECT FOR UPDATE SKIP LOCKED.
//
// Replaces the CMS's in-memory `syncInProgress` guard which does not
// survive Railway horizontal scaling. The lock row must be pre-seeded
// (migration 0001_init creates the `sync_locks` table; seed the
// "core-sync" key on first run).

import type { PrismaClient } from "@prisma/client"

const LOCK_KEY = "core-sync"

export async function acquireSyncLock(
  prisma: PrismaClient,
  heldBy: string,
): Promise<boolean> {
  // Ensure the lock row exists (idempotent)
  await prisma.syncLock.upsert({
    where: { key: LOCK_KEY },
    create: { key: LOCK_KEY },
    update: {},
  })

  // Try to claim the lock via raw SQL with SKIP LOCKED
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    SELECT key FROM sync_locks
    WHERE key = ${LOCK_KEY} AND held_by IS NULL
    FOR UPDATE SKIP LOCKED
  `

  if (rows.length === 0) return false

  await prisma.syncLock.update({
    where: { key: LOCK_KEY },
    data: { heldBy, acquiredAt: new Date() },
  })

  return true
}

export async function releaseSyncLock(prisma: PrismaClient): Promise<void> {
  await prisma.syncLock.update({
    where: { key: LOCK_KEY },
    data: { heldBy: null, acquiredAt: null },
  })
}
