import type { Prisma } from "@prisma/client"

/** Same minimized audit lifetime as owner releases; never holds raw source FKs. */
export async function purgeExpiredCowatchRefreshMetadata(
  tx: Prisma.TransactionClient,
  now: Date,
) {
  const cutoff = new Date(now.getTime() - 2555 * 86_400_000)
  const attempts =
    await tx.$executeRaw`DELETE FROM recommendation_cowatch_refresh_attempt WHERE id IN (
    SELECT id FROM recommendation_cowatch_refresh_attempt
    WHERE started_at <= ${cutoff} AND status <> 'running'
    ORDER BY started_at, id LIMIT 500 FOR UPDATE SKIP LOCKED
  )`
  const grants =
    await tx.$executeRaw`DELETE FROM recommendation_cowatch_refresh_grant WHERE id IN (
    SELECT delegation.id FROM recommendation_cowatch_refresh_grant delegation
    WHERE delegation.approved_at <= ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM recommendation_cowatch_refresh_attempt attempt WHERE attempt.grant_id = delegation.id)
    ORDER BY delegation.approved_at, delegation.id LIMIT 500 FOR UPDATE SKIP LOCKED
  )`
  return { attempts, grants }
}
