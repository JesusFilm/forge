import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "@/services/errors"
import {
  assertIsolatedPrecomputedControlFixture,
  loadPrecomputedPublicControl,
} from "./public-control"
import { readControlRouting } from "./visit-admission"
import {
  loadPrecomputedIncumbentBaseline,
  loadPrecomputedIncumbentBaselineReport,
} from "./incumbent-baseline"
import { loadWebWatchMeasurement } from "./web-measurement"
import { evaluatePrecomputedLiveFacts } from "./live-readiness"
import { loadPrecomputedFullCatalogSourceSet } from "./catalog"
import type { CtrPolicySettings } from "./ctr-policy"

const experimentSelect = {
  id: true,
  generationId: true,
  configurationDigest: true,
  controlRoutingDigest: true,
  sourceSetDigest: true,
  startsAt: true,
  endsAt: true,
  expiresAt: true,
  liveEvidence: true,
  ctrPolicy: {
    select: { authority: true, settings: true, settingsDigest: true },
  },
  ctrReports: {
    take: 1,
    orderBy: { revision: "desc" as const },
    select: {
      revision: true,
      isFinal: true,
      evidenceDigest: true,
      result: true,
    },
  },
} as const

/** Read-only operator snapshot. A completed build, a fixture win, and an
 * observed traffic count never constitute a live launch certificate. */
export async function loadPrecomputedPublicReadiness(
  prisma: PrismaClient,
  reviewer: Principal | null,
) {
  if (!hasPermission(reviewer, "read:recommendation-aggregates"))
    throw new ForbiddenError()
  const control = await loadPrecomputedPublicControl(prisma)
  const [routing, generations, experiments, baseline] = await Promise.all([
    readControlRouting(prisma),
    prisma.recommendationPrecomputedGeneration.findMany({
      where: { status: "complete" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        status: true,
        protocolVersion: true,
        modelId: true,
        inputMode: true,
        inputCutoff: true,
        historicalQualificationDigest: true,
        sourceSetDigest: true,
        expectedSourceCount: true,
        capacityPreflight: true,
        completedAt: true,
      },
    }),
    prisma.recommendationPrecomputedExperiment.findMany({
      where: { state: "public_ready" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: experimentSelect,
    }),
    loadPrecomputedIncumbentBaseline(prisma),
  ])
  const baselineReport = baseline
    ? await loadPrecomputedIncumbentBaselineReport(prisma, baseline.id)
    : null
  const [baselinePhysical] = baselineReport?.isFinal
    ? await prisma.$queryRaw<Array<{ bytes: bigint }>>`
        SELECT (pg_total_relation_size('recommendation_precomputed_baseline_visit') +
                pg_total_relation_size('recommendation_precomputed_baseline_visit_request'))::bigint AS bytes`
    : []
  const now = new Date()
  const baselineStart = baseline ? new Date(baseline.startsAt) : null
  const baselineEnd = baseline
    ? new Date(
        Math.min(
          new Date(baseline.endsAt).getTime(),
          baseline.stoppedAt
            ? new Date(baseline.stoppedAt).getTime()
            : Infinity,
        ),
      )
    : null
  const completedHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const baselineCoveredEnd = baselineEnd
    ? Math.min(
        Math.floor(baselineEnd.getTime() / 3_600_000) * 3_600_000,
        completedHour,
      )
    : 0
  const baselineWebMeasurement =
    baselineStart && baselineCoveredEnd > baselineStart.getTime()
      ? await loadWebWatchMeasurement(
          baselineStart,
          new Date(baselineCoveredEnd),
          { now },
        )
      : null
  const baselineFullHourWindow =
    baselineEnd != null &&
    baselineEnd.getTime() % 3_600_000 === 0 &&
    baselineCoveredEnd === baselineEnd.getTime()
  const baselineWebComplete =
    baselineFullHourWindow && baselineWebMeasurement?.status === "complete"
  const baselineRequestToVisitGap =
    baselineFullHourWindow &&
    baselineWebMeasurement?.status === "complete" &&
    baselineReport != null &&
    baselineWebMeasurement.counters.delivery_qualified <
      baselineReport.eligibleVisits
  const latestGeneration = generations[0]
  const fullCatalog = latestGeneration
    ? await loadPrecomputedFullCatalogSourceSet(
        prisma,
        latestGeneration.inputCutoff,
      ).catch(() => null)
    : null
  const livePrepared = experiments.find(
    (item) =>
      item.liveEvidence != null &&
      item.ctrPolicy?.authority === "prelaunch_agreed",
  )
  const [latestCapacity, sourceCount, modelCallCount, unknownModelCostCount] =
    latestGeneration
      ? await Promise.all([
          prisma.recommendationPrecomputedLaunchCapacityReceipt.findFirst({
            where: { generationId: latestGeneration.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
          prisma.recommendationPrecomputedSource.count({
            where: { generationId: latestGeneration.id },
          }),
          prisma.recommendationPrecomputedModelCall.count({
            where: { generationId: latestGeneration.id },
          }),
          prisma.recommendationPrecomputedModelCall.count({
            where: { generationId: latestGeneration.id, costUsd: null },
          }),
        ])
      : [null, 0, 0, 0]
  const agreedSettings = livePrepared?.ctrPolicy?.settings as
    | CtrPolicySettings
    | undefined
  const unresolved = evaluatePrecomputedLiveFacts({
    now,
    policy:
      agreedSettings && livePrepared?.ctrPolicy
        ? {
            authority: livePrepared.ctrPolicy.authority,
            digest: livePrepared.ctrPolicy.settingsDigest,
            baselineHumanVisitCtr: agreedSettings.baselineHumanVisitCtr,
            maximumEndToEndLossRate:
              agreedSettings.maximumEndToEndLossRate ?? null,
          }
        : null,
    baseline:
      baseline && baselineReport
        ? {
            authority: baseline.verificationAuthority,
            isFinal: baselineReport.isFinal && baseline.stoppedAt === null,
            reportDigest: baseline.finalReportDigest ?? "",
            eligibleVisits: baselineReport.eligibleVisits,
            visitCtr: baselineReport.visitCtr,
            startsAt: baseline.startsAt,
            endsAt: baseline.endsAt,
          }
        : null,
    web:
      baselineWebMeasurement && baselineWebMeasurement.status !== "unavailable"
        ? {
            status: baselineWebComplete
              ? baselineWebMeasurement.status
              : "incomplete",
            startHour: baselineWebMeasurement.startHour,
            endHourExclusive: baselineWebMeasurement.endHourExclusive,
            requestedHours: baselineWebMeasurement.requestedHours,
            coveredHours: baselineWebMeasurement.coveredHours,
            missingHours: baselineWebMeasurement.missingHours,
            imbalancedHours: baselineWebMeasurement.imbalancedHours,
            qualifiedRequestAttempts:
              baselineWebMeasurement.counters.delivery_qualified,
            clickUnavailable: baselineWebMeasurement.counters.click_unavailable,
            verificationUnavailable:
              baselineWebMeasurement.counters.delivery_verification_unavailable,
          }
        : null,
    generation: latestGeneration
      ? {
          status: latestGeneration.status,
          protocolVersion: latestGeneration.protocolVersion,
          modelId: latestGeneration.modelId,
          inputMode: latestGeneration.inputMode,
          sourceSetDigest: latestGeneration.sourceSetDigest,
          historicalQualificationDigest:
            latestGeneration.historicalQualificationDigest,
          expectedSourceCount: latestGeneration.expectedSourceCount,
          sourceCount,
          catalogSourceCount: fullCatalog?.sourceCount ?? null,
          catalogSourceSetDigest: fullCatalog?.sourceSetDigest ?? null,
          modelCallCount,
          unknownModelCostCount,
        }
      : null,
    capacity: latestCapacity
      ? {
          status: latestCapacity.status,
          receiptDigest: latestCapacity.receiptDigest,
          measuredAt: latestCapacity.measuredAt.toISOString(),
          availableAfterReserveBytes: Number(
            latestCapacity.availableAfterReserveBytes,
          ),
          projectedBytes: Number(latestCapacity.projectedBytes),
        }
      : null,
    hourAlignedCohort: true,
  })
  const retained =
    control.retainedExperimentId &&
    !experiments.some((item) => item.id === control.retainedExperimentId)
      ? await prisma.recommendationPrecomputedExperiment.findUnique({
          where: { id: control.retainedExperimentId },
          select: experimentSelect,
        })
      : null
  let fixtureRehearsalEnvironment = false
  try {
    await assertIsolatedPrecomputedControlFixture(prisma)
    fixtureRehearsalEnvironment = true
  } catch {
    // Readiness remains available on ordinary production databases.
  }
  return {
    schemaVersion: 1 as const,
    control,
    baseline,
    baselineReport,
    baselineCapacitySample: baselineReport?.isFinal
      ? {
          verifiedVisits: baselineReport.eligibleVisits,
          physicalVisitBytes: Number(baselinePhysical?.bytes ?? 0),
        }
      : null,
    baselineWebMeasurement,
    baselineFullHourWindow,
    baselineRequestToVisitGap,
    launchCapacityReceipt: latestCapacity
      ? {
          id: latestCapacity.id,
          generationId: latestCapacity.generationId,
          receiptDigest: latestCapacity.receiptDigest,
          status: latestCapacity.status,
          measuredAt: latestCapacity.measuredAt,
          projectedBytes: latestCapacity.projectedBytes.toString(),
          availableAfterReserveBytes:
            latestCapacity.availableAfterReserveBytes.toString(),
        }
      : null,
    incumbentRouting: routing
      ? {
          manifestId: routing.manifest.id,
          routingDigest: routing.routingDigest,
        }
      : null,
    generations,
    authoritativeCatalogCoverage: latestGeneration
      ? {
          generationId: latestGeneration.id,
          authoritativeSourceCount: fullCatalog?.sourceCount ?? null,
          authoritativeSourceSetDigest: fullCatalog?.sourceSetDigest ?? null,
          generationSourceCount: latestGeneration.expectedSourceCount,
          generationSourceSetDigest: latestGeneration.sourceSetDigest,
        }
      : null,
    experiments: [...experiments, ...(retained ? [retained] : [])].map(
      ({ ctrReports, ...item }) => ({
        ...item,
        latestReport: ctrReports[0] ?? null,
      }),
    ),
    fixtureRehearsalEnvironment,
    liveActivation: {
      status: unresolved.length ? ("blocked" as const) : ("ready" as const),
      reason: unresolved.length
        ? ("live_launch_evidence_incomplete" as const)
        : ("manual_start_required" as const),
      unresolved,
    },
  }
}
