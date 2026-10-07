import { createHash, randomUUID } from "node:crypto"
import { type PrismaClient } from "@prisma/client"
import type { z } from "zod"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "@/services/errors"
import { capacityMeasurement } from "./durable-build"
import { hasSealedGaCapture } from "./ga-capture-artifact"
import type { PrecomputedBaselineReport } from "./incumbent-baseline"

const MIN_RESERVE_BYTES = 5_000_000_000
const MAX_AGE_MS = 30 * 60_000
const REVIEW_MS = 365 * 86_400_000
type Measurement = z.infer<typeof capacityMeasurement>

export class PrecomputedLaunchCapacityError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "evidence_unavailable"
      | "stale_measurement",
  ) {
    super(code)
    this.name = "PrecomputedLaunchCapacityError"
  }
}

export function calculateLaunchCapacity(input: {
  verifiedVisits: number
  measuredFootprintBytes: number
  projectedBytes: number
  availableBytes: number
  reserveBytes: number
  reservedBuildBytes: number
  observedDbGrowthBytes: number
  recentTerminalProjectedBytes: number
}) {
  // The seven-day verified sample is scaled to the 29-day raw retention
  // window and doubled for cardinality, indexes, WAL, and demand variance.
  const minimumProjectedBytes = Math.ceil(
    (2 * input.measuredFootprintBytes * 29) / 7,
  )
  const unaccountedGrowthBytes = Math.max(
    input.observedDbGrowthBytes,
    input.recentTerminalProjectedBytes,
  )
  const availableAfterReserveBytes =
    input.availableBytes -
    input.reserveBytes -
    input.reservedBuildBytes -
    unaccountedGrowthBytes
  return {
    minimumProjectedBytes,
    unaccountedGrowthBytes,
    availableAfterReserveBytes,
    status:
      input.verifiedVisits > 0 &&
      input.reserveBytes >= MIN_RESERVE_BYTES &&
      input.projectedBytes >= minimumProjectedBytes &&
      availableAfterReserveBytes >= input.projectedBytes
        ? ("passed" as const)
        : ("insufficient" as const),
  }
}

/** Refresh a launch-only receipt against the same externally attested
 * cluster/disk contract as a build. It never edits a completed generation. */
export async function attestPrecomputedLaunchCapacity(
  prisma: PrismaClient,
  input: {
    generationId: string
    measurement: Measurement
    operator: Principal | null
    now?: Date
  },
) {
  if (!hasPermission(input.operator, "operate:recommendation-experiments"))
    throw new ForbiddenError()
  if (
    !input.operator?.id ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,190}$/.test(input.generationId)
  )
    throw new PrecomputedLaunchCapacityError("invalid_input")
  const parsed = capacityMeasurement.safeParse(input.measurement)
  if (!parsed.success) throw new PrecomputedLaunchCapacityError("invalid_input")
  const measurement = parsed.data
  const now = input.now ?? new Date()
  const age = now.getTime() - Date.parse(measurement.measuredAt)
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS)
    throw new PrecomputedLaunchCapacityError("stale_measurement")
  if (measurement.reserveBytes < MIN_RESERVE_BYTES)
    throw new PrecomputedLaunchCapacityError("invalid_input")

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('recommendation_precomputed_build_capacity'))::text AS held`
      const generation =
        await tx.recommendationPrecomputedGeneration.findUnique({
          where: { id: input.generationId },
          select: {
            status: true,
            protocolVersion: true,
            capacityPreflight: true,
            historicalQualification: true,
            id: true,
            inputDigest: true,
            sourceSetDigest: true,
            inputCutoff: true,
          },
        })
      const baseline = await tx.recommendationPrecomputedBaselineRun.findFirst({
        where: {
          verificationAuthority: "live_verified",
          finalReportDigest: { not: null },
        },
        orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
      })
      const report = baseline?.finalReport as PrecomputedBaselineReport | null
      if (
        generation?.status !== "complete" ||
        (generation.protocolVersion !== 2 &&
          (generation.protocolVersion !== 3 ||
            !hasSealedGaCapture(
              generation.historicalQualification,
              generation,
            ))) ||
        (generation.capacityPreflight as { status?: string } | null)?.status !==
          "passed" ||
        !baseline ||
        !report?.isFinal ||
        report.eligibleVisits <= 0 ||
        report.evidenceBasis !== "verified_incumbent_baseline" ||
        baseline.stoppedAt ||
        baseline.endsAt.getTime() - baseline.startsAt.getTime() !==
          7 * 86_400_000
      )
        throw new PrecomputedLaunchCapacityError("evidence_unavailable")

      const [db] = await tx.$queryRaw<
        Array<{
          observed_db_bytes: bigint
          cluster_system_id: string
          baseline_visit_bytes: bigint
          baseline_request_bytes: bigint
          ordinary_row_bytes: bigint
          ordinary_physical_bytes: bigint
          ordinary_heap_bytes: bigint
          request_rows: bigint
        }>
      >`
      WITH window_requests AS (
        SELECT request.id AS request_id
        FROM recommendation_request request
        WHERE request.created_at >= ${baseline.startsAt}
          AND request.created_at < ${baseline.endsAt}
      ), ordinary AS (
        SELECT
          (SELECT count(*) FROM recommendation_request request
           JOIN window_requests ON window_requests.request_id = request.id)::bigint AS request_rows,
          (SELECT COALESCE(sum(pg_column_size(request)), 0) FROM recommendation_request request
           JOIN window_requests ON window_requests.request_id = request.id) +
          (SELECT COALESCE(sum(pg_column_size(item)), 0) FROM recommendation_served_item item
           JOIN window_requests ON window_requests.request_id = item.request_id) +
          (SELECT COALESCE(sum(pg_column_size(rendered)), 0) FROM recommendation_rendered_fact rendered
           JOIN window_requests ON window_requests.request_id = rendered.request_id) +
          (SELECT COALESCE(sum(pg_column_size(impression)), 0) FROM recommendation_impression impression
           JOIN window_requests ON window_requests.request_id = impression.request_id) +
          (SELECT COALESCE(sum(pg_column_size(selection)), 0) FROM recommendation_selection selection
           JOIN window_requests ON window_requests.request_id = selection.request_id) +
          (SELECT COALESCE(sum(pg_column_size(audit)), 0) FROM recommendation_evidence_audit audit
           JOIN window_requests ON window_requests.request_id = audit.request_id) +
          (SELECT COALESCE(sum(pg_column_size(run)), 0) FROM recommendation_candidate_run run
           JOIN window_requests ON window_requests.request_id = run.request_id) +
          (SELECT COALESCE(sum(pg_column_size(evidence)), 0) FROM recommendation_candidate_stage_evidence evidence
           JOIN recommendation_candidate_run run ON run.id = evidence.run_id
           JOIN window_requests ON window_requests.request_id = run.request_id) +
          (SELECT COALESCE(sum(pg_column_size(episode)), 0) FROM recommendation_playback_episode episode
           JOIN window_requests ON window_requests.request_id = episode.request_id) +
          (SELECT COALESCE(sum(pg_column_size(fact)), 0) FROM recommendation_playback_fact fact
           JOIN window_requests ON window_requests.request_id = fact.request_id) +
          (SELECT COALESCE(sum(pg_column_size(revision)), 0) FROM recommendation_outcome_revision revision
           JOIN window_requests ON window_requests.request_id = revision.request_id) +
          (SELECT COALESCE(sum(pg_column_size(conflict)), 0) FROM recommendation_conflict conflict
           JOIN window_requests ON window_requests.request_id = conflict.request_id) +
          (SELECT COALESCE(sum(pg_column_size(budget)), 0) FROM recommendation_capability_submission_budget budget
           JOIN window_requests ON window_requests.request_id = budget.request_id) +
          (SELECT COALESCE(sum(pg_column_size(action)), 0) FROM recommendation_content_action action
           JOIN window_requests ON window_requests.request_id = action.request_id) +
          (SELECT COALESCE(sum(pg_column_size(access)), 0) FROM recommendation_trace_access_audit access
           JOIN window_requests ON window_requests.request_id = access.request_id) +
          (SELECT COALESCE(sum(pg_column_size(exposure)), 0) FROM recommendation_experiment_exposure exposure
           JOIN window_requests ON window_requests.request_id = exposure.request_id) +
          (SELECT COALESCE(sum(pg_column_size(assignment)), 0) FROM recommendation_experiment_assignment assignment
           WHERE EXISTS (
             SELECT 1 FROM recommendation_request request
             JOIN window_requests ON window_requests.request_id = request.id
             WHERE request.experiment_assignment_id = assignment.id
           )) +
          (SELECT COALESCE(sum(pg_column_size(shadow)), 0) FROM recommendation_shadow_run shadow
           JOIN window_requests ON window_requests.request_id = shadow.request_id) +
          (SELECT COALESCE(sum(pg_column_size(nomination)), 0) FROM recommendation_shadow_nomination nomination
           JOIN recommendation_shadow_run shadow ON shadow.id = nomination.run_id
           JOIN window_requests ON window_requests.request_id = shadow.request_id) +
          (SELECT COALESCE(sum(pg_column_size(evaluation)), 0) FROM recommendation_shadow_evaluation evaluation
           WHERE EXISTS (
             SELECT 1 FROM recommendation_shadow_run shadow
             JOIN window_requests ON window_requests.request_id = shadow.request_id
             WHERE shadow.evaluation_id = evaluation.id
           )) +
          (SELECT COALESCE(sum(pg_column_size(decision)), 0) FROM recommendation_shadow_decision decision
           WHERE EXISTS (
             SELECT 1 FROM recommendation_shadow_run shadow
             JOIN window_requests ON window_requests.request_id = shadow.request_id
             WHERE shadow.evaluation_id = decision.evaluation_id
           )) +
          (SELECT COALESCE(sum(pg_column_size(fence)), 0) FROM recommendation_promotion_slate_fence fence
           JOIN window_requests ON window_requests.request_id = fence.request_id) +
          (SELECT COALESCE(sum(pg_column_size(personalization)), 0) FROM recommendation_personalization_decision personalization
           JOIN window_requests ON window_requests.request_id = personalization.request_id) +
          (SELECT COALESCE(sum(pg_column_size(link)), 0) FROM recommendation_precomputed_visit_request link
           JOIN window_requests ON window_requests.request_id = link.request_id) AS ordinary_row_bytes
      )
      SELECT pg_database_size(current_database())::bigint AS observed_db_bytes,
        (SELECT system_identifier::text FROM pg_control_system()) AS cluster_system_id,
        pg_total_relation_size('recommendation_precomputed_baseline_visit')::bigint AS baseline_visit_bytes,
        pg_total_relation_size('recommendation_precomputed_baseline_visit_request')::bigint AS baseline_request_bytes,
        ordinary.ordinary_row_bytes::bigint AS ordinary_row_bytes,
        (SELECT COALESCE(sum(pg_total_relation_size(name::regclass)), 0)::bigint
         FROM unnest(ARRAY[
           'recommendation_request', 'recommendation_served_item',
           'recommendation_rendered_fact', 'recommendation_impression',
           'recommendation_selection', 'recommendation_evidence_audit',
           'recommendation_candidate_run', 'recommendation_candidate_stage_evidence',
           'recommendation_playback_episode', 'recommendation_playback_fact',
           'recommendation_outcome_revision', 'recommendation_conflict',
           'recommendation_capability_submission_budget', 'recommendation_content_action',
           'recommendation_trace_access_audit', 'recommendation_experiment_exposure',
           'recommendation_experiment_assignment', 'recommendation_shadow_run',
           'recommendation_shadow_nomination', 'recommendation_shadow_evaluation',
           'recommendation_shadow_decision',
           'recommendation_promotion_slate_fence', 'recommendation_personalization_decision',
           'recommendation_precomputed_visit_request'
         ]::text[]) AS name) AS ordinary_physical_bytes,
        (SELECT COALESCE(sum(pg_relation_size(name::regclass)), 0)::bigint
         FROM unnest(ARRAY[
           'recommendation_request', 'recommendation_served_item',
           'recommendation_rendered_fact', 'recommendation_impression',
           'recommendation_selection', 'recommendation_evidence_audit',
           'recommendation_candidate_run', 'recommendation_candidate_stage_evidence',
           'recommendation_playback_episode', 'recommendation_playback_fact',
           'recommendation_outcome_revision', 'recommendation_conflict',
           'recommendation_capability_submission_budget', 'recommendation_content_action',
           'recommendation_trace_access_audit', 'recommendation_experiment_exposure',
           'recommendation_experiment_assignment', 'recommendation_shadow_run',
           'recommendation_shadow_nomination', 'recommendation_shadow_evaluation',
           'recommendation_shadow_decision',
           'recommendation_promotion_slate_fence', 'recommendation_personalization_decision',
           'recommendation_precomputed_visit_request'
         ]::text[]) AS name) AS ordinary_heap_bytes,
        ordinary.request_rows
      FROM ordinary`
      if (
        !db?.cluster_system_id ||
        db.cluster_system_id !== measurement.clusterSystemId ||
        Math.abs(Number(db.observed_db_bytes) - measurement.observedDbBytes) >
          Math.max(256_000_000, Number(db.observed_db_bytes) * 0.02)
      )
        throw new PrecomputedLaunchCapacityError("evidence_unavailable")
      const measuredVisitBytes = Number(
        db.baseline_visit_bytes + db.baseline_request_bytes,
      )
      const ordinaryRowBytes = Number(db.ordinary_row_bytes)
      const observedPhysicalRatio =
        Number(db.ordinary_physical_bytes) /
        Math.max(1, Number(db.ordinary_heap_bytes))
      const projectionPhysicalMultiplier = Math.max(
        4,
        Math.ceil(observedPhysicalRatio),
      )
      // Native row values include all ordinary requests in the baseline window,
      // including failures and unverified/bot-bound requests, plus their packed
      // payloads, delivery diagnostics, children, candidate evidence and audits.
      // The multiplier and A/B floor are conservative projection assumptions;
      // neither measures WAL or future traffic directly.
      const measuredFootprintBytes =
        measuredVisitBytes +
        projectionPhysicalMultiplier * ordinaryRowBytes +
        4_096 * report.eligibleVisits
      if (
        !Number.isSafeInteger(measuredFootprintBytes) ||
        measuredFootprintBytes <= 0
      )
        throw new PrecomputedLaunchCapacityError("evidence_unavailable")
      if (
        measurement.sampleSourceCount !== report.eligibleVisits ||
        report.linkedDeliveryRequests <= 0 ||
        Number(db.request_rows) < report.linkedDeliveryRequests ||
        ordinaryRowBytes <= 0 ||
        measurement.sampleBytes < measuredFootprintBytes
      )
        throw new PrecomputedLaunchCapacityError("invalid_input")

      const [overlap] = await tx.$queryRaw<
        Array<{
          active_bytes: bigint
          recent_terminal_bytes: bigint
        }>
      >`
      SELECT
        COALESCE(sum(GREATEST(
          COALESCE((capacity_preflight->>'heldProjectionBytes')::bigint, 0),
          (capacity_preflight->>'projectedBytes')::bigint
        )) FILTER (
          WHERE (status = 'incomplete' AND capacity_preflight->>'status' = 'passed')
            OR (status = 'capacity_blocked'
              AND (capacity_preflight->>'heldProjectionBytes')::bigint > 0
              AND (capacity_preflight->>'blockedAt')::timestamptz >= ${new Date(measurement.measuredAt)})
        ), 0)::bigint AS active_bytes,
        COALESCE(sum(GREATEST(
          COALESCE((capacity_preflight->>'heldProjectionBytes')::bigint, 0),
          (capacity_preflight->>'projectedBytes')::bigint
        )) FILTER (
          WHERE status IN ('complete', 'failed', 'cancelled')
            AND COALESCE(completed_at, failed_at, cancelled_at) >= ${new Date(measurement.measuredAt)}
        ), 0)::bigint AS recent_terminal_bytes
      FROM recommendation_precomputed_generation
      WHERE id <> ${input.generationId} AND protocol_version IN (2, 3)
        AND capacity_preflight->>'projectedBytes' IS NOT NULL`
      const calculation = calculateLaunchCapacity({
        verifiedVisits: report.eligibleVisits,
        measuredFootprintBytes: Math.max(
          measuredFootprintBytes,
          measurement.sampleBytes,
        ),
        projectedBytes: measurement.projectedBytes,
        availableBytes: measurement.availableBytes,
        reserveBytes: measurement.reserveBytes,
        reservedBuildBytes: Number(overlap?.active_bytes ?? 0),
        observedDbGrowthBytes: Math.max(
          0,
          Number(db.observed_db_bytes) - measurement.observedDbBytes,
        ),
        recentTerminalProjectedBytes: Number(
          overlap?.recent_terminal_bytes ?? 0,
        ),
      })
      const id = randomUUID()
      const evidence = {
        contractVersion: "precomputed-launch-capacity-v1",
        measurement,
        baselineId: baseline.id,
        baselineReportDigest: baseline.finalReportDigest,
        observedDbBytes: Number(db.observed_db_bytes),
        measuredVisitBytes,
        ordinaryRowBytes,
        allTrafficRequestRows: Number(db.request_rows),
        linkedDeliveryRequests: report.linkedDeliveryRequests,
        observedPhysicalRatio,
        projectionPhysicalMultiplier,
        projectionAssumptions: {
          ordinaryPhysicalAndWalMultiplierFloor: 4,
          abVisitAndAggregateBytesPerVerifiedVisit: 4_096,
          retentionDays: 29,
          sampleDays: 7,
          demandVarianceMultiplier: 2,
          walDirectlyMeasured: false,
        },
        measuredFootprintBytes,
        reservedBuildBytes: Number(overlap?.active_bytes ?? 0),
        recentTerminalProjectedBytes: Number(
          overlap?.recent_terminal_bytes ?? 0,
        ),
        ...calculation,
      }
      const receiptDigest = createHash("sha256")
        .update(JSON.stringify(evidence))
        .digest("hex")
      const receipt =
        await tx.recommendationPrecomputedLaunchCapacityReceipt.create({
          data: {
            id,
            generationId: input.generationId,
            actorId: input.operator!.id!,
            measurement: evidence,
            receiptDigest,
            status: calculation.status,
            measuredAt: new Date(measurement.measuredAt),
            observedDbBytes: db.observed_db_bytes,
            projectedBytes: BigInt(measurement.projectedBytes),
            availableAfterReserveBytes: BigInt(
              calculation.availableAfterReserveBytes,
            ),
            createdAt: now,
            expiresAt: new Date(now.getTime() + REVIEW_MS),
          },
        })
      return {
        id: receipt.id,
        generationId: receipt.generationId,
        status: receipt.status,
        receiptDigest: receipt.receiptDigest,
        measuredAt: receipt.measuredAt.toISOString(),
        projectedBytes: receipt.projectedBytes.toString(),
        availableAfterReserveBytes:
          receipt.availableAfterReserveBytes.toString(),
      }
    },
    { timeout: 120_000 },
  )
}
