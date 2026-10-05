import type { Prisma } from "@prisma/client"

/** Bound each daily pass to the shared recommendation retention batch size. */
export async function purgeExpiredPrecomputedVisitRoots(
  tx: Prisma.TransactionClient,
  now: Date,
  batchSize: number,
) {
  const visits = await tx.recommendationPrecomputedVisit.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true },
  })
  const visitsDeleted = await tx.recommendationPrecomputedVisit.deleteMany({
    where: {
      id: { in: visits.map(({ id }) => id) },
      expiresAt: { lte: now },
    },
  })
  // Deleting a visit cascades its thin request links. Keep the frozen config
  // longer for audit, then remove it only after every raw visit is gone.
  const experiments = await tx.recommendationPrecomputedExperiment.findMany({
    where: { expiresAt: { lte: now }, visits: { none: {} } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true },
  })
  const experimentsDeleted =
    await tx.recommendationPrecomputedExperiment.deleteMany({
      where: {
        id: { in: experiments.map(({ id }) => id) },
        expiresAt: { lte: now },
        visits: { none: {} },
      },
    })
  return {
    visitsDeleted: visitsDeleted.count,
    experimentsDeleted: experimentsDeleted.count,
    visitPageFull: visits.length === batchSize,
    experimentPageFull: experiments.length === batchSize,
  }
}
