import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import type { CtrPolicySettings } from "./ctr-policy"
import { loadPrecomputedFullCatalogSourceSet } from "./catalog"
import { precomputedCtrPolicyDigest } from "./ctr-report"
import type { PrecomputedBaselineReport } from "./incumbent-baseline"
import {
  evaluatePrecomputedLiveFacts,
  isUtcHour,
  type PrecomputedLiveFacts,
} from "./live-readiness"
import {
  loadWebWatchMeasurement,
  type WebWatchMeasurementRead,
} from "./web-measurement"

type Db = PrismaClient | Prisma.TransactionClient
export type LivePolicyAgreement = {
  authority: "prelaunch_agreed"
  settingsDigest: string
  baselineReportDigest: string
  launchCapacityReceiptDigest: string
}

export type LiveEvidenceSnapshot = {
  contractVersion: "precomputed-live-evidence-v1"
  baselineId: string | null
  baselineReportDigest: string | null
  launchCapacityReceiptId: string | null
  launchCapacityReceiptDigest: string | null
  generationId: string
  generationSourceSetDigest: string | null
  authoritativeCatalogSourceCount: number | null
  authoritativeCatalogSourceSetDigest: string | null
  historicalQualificationDigest: string | null
  modelCallCount: number
  unknownModelCostCount: number
  policyDigest: string
  policyAuthority: "prelaunch_agreed"
  webHealthDigest: string | null
  operatorId: string
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}

export function liveEvidenceDigest(
  value: LiveEvidenceSnapshot & { evidenceDigest?: string },
): string {
  const snapshot = { ...value }
  delete snapshot.evidenceDigest
  return createHash("sha256").update(canonical(snapshot)).digest("hex")
}

/** Authenticated Web telemetry is read outside a database transaction by
 * callers. DB rows are queried again under the prepare/start lock. */
export async function loadLiveEvidence(
  db: Db,
  input: {
    generationId: string
    startsAt: Date
    policySettings: CtrPolicySettings
    policyAgreement: LivePolicyAgreement | null
    operatorId: string
    now: Date
    capacityReceiptId?: string
    webMeasurement?: WebWatchMeasurementRead | null
  },
): Promise<{
  facts: PrecomputedLiveFacts
  reasons: string[]
  snapshot: LiveEvidenceSnapshot
  webMeasurement: WebWatchMeasurementRead | null
}> {
  const [
    baseline,
    generation,
    sourceCount,
    modelCalls,
    unknownModelCosts,
    capacity,
  ] = await Promise.all([
    db.recommendationPrecomputedBaselineRun.findFirst({
      where: { finalReportDigest: { not: null } },
      orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
    }),
    db.recommendationPrecomputedGeneration.findUnique({
      where: { id: input.generationId },
    }),
    db.recommendationPrecomputedSource.count({
      where: { generationId: input.generationId },
    }),
    db.recommendationPrecomputedModelCall.count({
      where: { generationId: input.generationId },
    }),
    db.recommendationPrecomputedModelCall.count({
      where: { generationId: input.generationId, costUsd: null },
    }),
    input.capacityReceiptId
      ? db.recommendationPrecomputedLaunchCapacityReceipt.findUnique({
          where: { id: input.capacityReceiptId },
        })
      : db.recommendationPrecomputedLaunchCapacityReceipt.findFirst({
          where: { generationId: input.generationId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
  ])
  const report = baseline?.finalReport as PrecomputedBaselineReport | null
  const catalog = generation
    ? await loadPrecomputedFullCatalogSourceSet(
        db,
        generation.inputCutoff,
      ).catch(() => null)
    : null
  const [currentCapacity] = capacity
    ? await db.$queryRaw<
        Array<{
          observed_db_bytes: bigint
          cluster_system_id: string
          active_reserved_bytes: bigint
        }>
      >`
        SELECT pg_database_size(current_database())::bigint AS observed_db_bytes,
          (SELECT system_identifier::text FROM pg_control_system()) AS cluster_system_id,
          COALESCE((SELECT sum(GREATEST(
            COALESCE((g.capacity_preflight->>'heldProjectionBytes')::bigint, 0),
            COALESCE((g.capacity_preflight->>'projectedBytes')::bigint, 0)
          )) FROM recommendation_precomputed_generation g
          WHERE (g.status = 'incomplete' AND g.capacity_preflight->>'status' = 'passed')
            OR (g.status = 'capacity_blocked' AND
                (g.capacity_preflight->>'heldProjectionBytes')::bigint > 0)), 0)::bigint
            AS active_reserved_bytes`
    : [null]
  const capacityEvidence = capacity?.measurement as {
    measurement?: { clusterSystemId?: string }
    reservedBuildBytes?: number
  } | null
  const capacityClusterMatches =
    currentCapacity?.cluster_system_id ===
    capacityEvidence?.measurement?.clusterSystemId
  const currentCapacityAvailable =
    capacity && currentCapacity && capacityEvidence
      ? Number(capacity.availableAfterReserveBytes) -
        Math.max(
          0,
          Number(currentCapacity.observed_db_bytes) -
            Number(capacity.observedDbBytes),
        ) -
        Math.max(
          0,
          Number(currentCapacity.active_reserved_bytes) -
            Number(capacityEvidence.reservedBuildBytes ?? 0),
        )
      : 0
  const web =
    input.webMeasurement !== undefined
      ? input.webMeasurement
      : baseline &&
          report?.isFinal &&
          isUtcHour(baseline.startsAt) &&
          isUtcHour(baseline.endsAt)
        ? await loadWebWatchMeasurement(baseline.startsAt, baseline.endsAt, {
            now: input.now,
          })
        : null
  const policyDigest = precomputedCtrPolicyDigest(input.policySettings)
  const facts: PrecomputedLiveFacts = {
    now: input.now,
    policy: input.policyAgreement
      ? {
          authority: input.policyAgreement.authority,
          digest: policyDigest,
          baselineHumanVisitCtr: input.policySettings.baselineHumanVisitCtr,
          maximumEndToEndLossRate:
            input.policySettings.maximumEndToEndLossRate ?? null,
        }
      : null,
    baseline:
      baseline && report
        ? {
            authority: baseline.verificationAuthority,
            isFinal: report.isFinal && baseline.stoppedAt === null,
            reportDigest: baseline.finalReportDigest ?? "",
            eligibleVisits: report.eligibleVisits,
            visitCtr: report.visitCtr,
            startsAt: baseline.startsAt.toISOString(),
            endsAt: baseline.endsAt.toISOString(),
          }
        : null,
    web:
      web && web.status !== "unavailable"
        ? {
            status: web.status,
            startHour: web.startHour,
            endHourExclusive: web.endHourExclusive,
            requestedHours: web.requestedHours,
            coveredHours: web.coveredHours,
            missingHours: web.missingHours,
            imbalancedHours: web.imbalancedHours,
            qualifiedRequestAttempts: web.counters.delivery_qualified,
            clickUnavailable: web.counters.click_unavailable,
            verificationUnavailable:
              web.counters.delivery_verification_unavailable,
          }
        : null,
    generation: generation
      ? {
          status: generation.status,
          protocolVersion: generation.protocolVersion,
          modelId: generation.modelId,
          inputMode: generation.inputMode,
          sourceSetDigest: generation.sourceSetDigest,
          historicalQualificationDigest:
            generation.historicalQualificationDigest,
          expectedSourceCount: generation.expectedSourceCount,
          sourceCount,
          catalogSourceCount: catalog?.sourceCount ?? null,
          catalogSourceSetDigest: catalog?.sourceSetDigest ?? null,
          modelCallCount: modelCalls,
          unknownModelCostCount: unknownModelCosts,
        }
      : null,
    capacity:
      capacity && capacity.generationId === input.generationId
        ? {
            status: capacityClusterMatches
              ? capacity.status
              : "cluster_mismatch",
            receiptDigest: capacity.receiptDigest,
            measuredAt: capacity.measuredAt.toISOString(),
            availableAfterReserveBytes: currentCapacityAvailable,
            projectedBytes: Number(capacity.projectedBytes),
          }
        : null,
    hourAlignedCohort: isUtcHour(input.startsAt),
  }
  const reasons = evaluatePrecomputedLiveFacts(facts)
  if (input.policyAgreement?.settingsDigest !== policyDigest)
    reasons.push("numeric_policy_digest_mismatch")
  if (
    input.policyAgreement?.baselineReportDigest !== baseline?.finalReportDigest
  )
    reasons.push("baseline_report_digest_mismatch")
  if (
    input.policyAgreement?.launchCapacityReceiptDigest !==
    capacity?.receiptDigest
  )
    reasons.push("launch_capacity_receipt_digest_mismatch")
  const webHealthDigest =
    web && web.status !== "unavailable"
      ? createHash("sha256")
          .update(
            JSON.stringify({
              status: web.status,
              startHour: web.startHour,
              endHourExclusive: web.endHourExclusive,
              requestedHours: web.requestedHours,
              coveredHours: web.coveredHours,
              missingHours: web.missingHours,
              imbalancedHours: web.imbalancedHours,
              counters: web.counters,
            }),
          )
          .digest("hex")
      : null
  const snapshot: LiveEvidenceSnapshot = {
    contractVersion: "precomputed-live-evidence-v1",
    baselineId: baseline?.id ?? null,
    baselineReportDigest: baseline?.finalReportDigest ?? null,
    launchCapacityReceiptId: capacity?.id ?? null,
    launchCapacityReceiptDigest: capacity?.receiptDigest ?? null,
    generationId: input.generationId,
    generationSourceSetDigest: generation?.sourceSetDigest ?? null,
    authoritativeCatalogSourceCount: catalog?.sourceCount ?? null,
    authoritativeCatalogSourceSetDigest: catalog?.sourceSetDigest ?? null,
    historicalQualificationDigest:
      generation?.historicalQualificationDigest ?? null,
    modelCallCount: modelCalls,
    unknownModelCostCount: unknownModelCosts,
    policyDigest,
    policyAuthority: "prelaunch_agreed",
    webHealthDigest,
    operatorId: input.operatorId,
  }
  return { facts, reasons, snapshot, webMeasurement: web }
}
