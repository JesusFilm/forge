import type { Prisma } from "@prisma/client"
import { lockPrecomputedCtrEvidence } from "./ctr-fence"
import { archivePrecomputedCtrVisits } from "./ctr-evidence"

/** Bound each daily pass to the shared recommendation retention batch size. */
export async function purgeExpiredPrecomputedVisitRoots(
  tx: Prisma.TransactionClient,
  now: Date,
  batchSize: number,
  requestIds: readonly string[] = [],
) {
  // A request selected for deletion may be linked to a newer expired visit
  // outside the ordinary oldest-visit page. Archive those roots first, then
  // fill the same bounded page with unrelated expired visits.
  const linked = requestIds.length
    ? await tx.recommendationPrecomputedVisit.findMany({
        where: {
          expiresAt: { lte: now },
          requests: { some: { requestId: { in: [...requestIds] } } },
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true, experimentId: true },
      })
    : []
  const ordinary = await tx.recommendationPrecomputedVisit.findMany({
    where: {
      expiresAt: { lte: now },
      id: { notIn: linked.map(({ id }) => id) },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: batchSize - linked.length,
    select: { id: true, experimentId: true },
  })
  const visits = [...linked, ...ordinary]
  for (const experimentId of [
    ...new Set(visits.map((visit) => visit.experimentId)),
  ].sort())
    await lockPrecomputedCtrEvidence(tx, experimentId, "exclusive")
  const current = await tx.recommendationPrecomputedVisit.findMany({
    where: {
      id: { in: visits.map(({ id }) => id) },
      expiresAt: { lte: now },
    },
    select: { id: true, experimentId: true },
  })
  await archivePrecomputedCtrVisits(tx, current, now)
  const visitsDeleted = await tx.recommendationPrecomputedVisit.deleteMany({
    where: {
      id: { in: current.map(({ id }) => id) },
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
