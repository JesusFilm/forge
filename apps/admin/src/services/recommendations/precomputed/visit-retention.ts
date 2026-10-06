import { Prisma } from "@prisma/client"
import { lockPrecomputedCtrEvidence } from "./ctr-fence"
import { archivePrecomputedCtrVisits } from "./ctr-evidence"
import { loadPrecomputedIncumbentBaselineReport } from "./incumbent-baseline"

/** Bound each daily pass to the shared recommendation retention batch size. */
export async function purgeExpiredPrecomputedVisitRoots(
  tx: Prisma.TransactionClient,
  now: Date,
  batchSize: number,
  requestIds: readonly string[] = [],
) {
  // Freeze compact baseline totals before any 29-day raw evidence is removed.
  // A seven-day collection window plus one-day click cutoff leaves ample
  // margin; delayed retention still finalizes before deleting the roots.
  const baselineRuns = await tx.recommendationPrecomputedBaselineRun.findMany({
    where: {
      finalReport: { equals: Prisma.DbNull },
      OR: [
        { endsAt: { lte: new Date(now.getTime() - 86_700_000) } },
        { stoppedAt: { lte: new Date(now.getTime() - 86_700_000) } },
      ],
    },
    orderBy: [{ endsAt: "asc" }, { id: "asc" }],
    take: Math.min(batchSize, 10),
    select: { id: true, endsAt: true, enabled: true },
  })
  for (const run of baselineRuns) {
    await loadPrecomputedIncumbentBaselineReport(tx, run.id, now)
    if (run.enabled && run.endsAt <= now)
      await tx.recommendationPrecomputedBaselineRun.updateMany({
        where: { id: run.id, enabled: true, stoppedAt: null },
        data: {
          enabled: false,
          stoppedAt: run.endsAt,
          stoppedBy: "system_window_end",
        },
      })
  }
  const baselineVisits =
    await tx.recommendationPrecomputedBaselineVisit.findMany({
      where: {
        expiresAt: { lte: now },
        run: { finalReport: { not: Prisma.DbNull } },
      },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: { id: true },
    })
  const baselineVisitsDeleted = (
    await tx.recommendationPrecomputedBaselineVisit.deleteMany({
      where: {
        id: { in: baselineVisits.map(({ id }) => id) },
        expiresAt: { lte: now },
      },
    })
  ).count
  const baselineExpiredRuns =
    await tx.recommendationPrecomputedBaselineRun.findMany({
      where: { expiresAt: { lte: now }, enabled: false, visits: { none: {} } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: { id: true },
    })
  const baselineRunsDeleted = (
    await tx.recommendationPrecomputedBaselineRun.deleteMany({
      where: {
        id: { in: baselineExpiredRuns.map(({ id }) => id) },
        enabled: false,
        visits: { none: {} },
      },
    })
  ).count
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
    where: {
      expiresAt: { lte: now },
      visits: { none: {} },
      activePublicControls: { none: {} },
      retainedPublicControls: { none: {} },
    },
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
        activePublicControls: { none: {} },
        retainedPublicControls: { none: {} },
      },
    })
  const eventsDeleted = await tx.$executeRaw`
    DELETE FROM recommendation_precomputed_public_control_event event
    WHERE event.id IN (
      SELECT expired.id FROM recommendation_precomputed_public_control_event expired
      WHERE expired.expires_at <= ${now}
      ORDER BY expired.expires_at, expired.control_version
      LIMIT ${batchSize}
    )`
  return {
    visitsDeleted: visitsDeleted.count,
    experimentsDeleted: experimentsDeleted.count,
    controlEventsDeleted: eventsDeleted,
    baselineVisitsDeleted,
    baselineRunsDeleted,
    baselineVisitPageFull: baselineVisits.length === batchSize,
    baselineFinalizationPageFull:
      baselineRuns.length === Math.min(batchSize, 10),
    baselineRunPageFull: baselineExpiredRuns.length === batchSize,
    visitPageFull: visits.length === batchSize,
    experimentPageFull: experiments.length === batchSize,
    controlEventPageFull: eventsDeleted === batchSize,
  }
}
