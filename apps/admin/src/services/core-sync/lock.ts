// DB-backed sync lock — atomic UPDATE WHERE held_by IS NULL.
//
// Replaces the CMS's in-memory `syncInProgress` guard which does not
// survive Railway horizontal scaling.

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

  // Atomic claim: UPDATE only if not held. Returns affected count.
  const claimed = await prisma.$executeRaw`
    UPDATE sync_locks
    SET held_by = ${heldBy}, acquired_at = NOW()
    WHERE key = ${LOCK_KEY} AND held_by IS NULL
  `

  return claimed > 0
}

export async function releaseSyncLock(prisma: PrismaClient): Promise<void> {
  await prisma.syncLock.update({
    where: { key: LOCK_KEY },
    data: { heldBy: null, acquiredAt: null },
  })
}
