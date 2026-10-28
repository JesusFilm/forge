import { Prisma, type PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { rawCtrVisitSql, type RawCtrVisit } from "./ctr-evidence"

/** Shadow only: reports and retention keep their established raw authority. */
export async function capturePrecomputedCtrMeasurement(
  tx: Prisma.TransactionClient,
  visitId: string,
  acceptedAt: Date,
): Promise<void> {
  if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1") return
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM recommendation_precomputed_visit
    WHERE id = ${visitId}::uuid FOR UPDATE
  `)
  if (locked.length !== 1) return
  const rows = await tx.$queryRaw<RawCtrVisit[]>(
    rawCtrVisitSql(Prisma.sql`v.id = ${visitId}::uuid`, acceptedAt),
  )
  if (rows.length !== 1) throw new Error("precomputed_compact_visit_mismatch")
  const row = rows[0]
  const derived = {
    arm: row.arm,
    eligibility: row.eligibility,
    qualification: row.qualification,
    exclusion_reason: row.exclusion_reason,
    delivery_result: row.delivery_result,
    accepted_selections: row.accepted_selections,
    qualified_impressions: row.qualified_impressions,
    matched_selections: row.matched_selections,
    actual_fallback: row.actual_fallback,
    private_recovery_attempt: row.private_recovery_attempt,
    unlinked_delivered: row.unlinked_delivered,
    unversioned: row.unversioned,
    qualified_playbacks: row.qualified_playbacks,
    active_playback_milliseconds: row.active_playback_milliseconds,
    claimed_playbacks: row.claimed_playbacks,
    observed_playbacks: row.observed_playbacks,
    complete_playbacks: row.complete_playbacks,
    partial_playbacks: row.partial_playbacks,
    missing_outcome_playbacks: row.missing_outcome_playbacks,
    missing_coverage_playbacks: row.missing_coverage_playbacks,
    pending_playbacks: row.pending_playbacks,
    invalid_playbacks: row.invalid_playbacks,
  }
  const [pending] = await tx.$queryRaw<
    Array<{ cutoff_ceiling_at: Date; pending_deadlines: Date[] | null }>
  >(Prisma.sql`
    SELECT LEAST(v.expires_at, experiment.ends_at +
      COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour') AS cutoff_ceiling_at,
      array_agg(episode.hard_until) FILTER (
        WHERE episode.state IN ('finalized', 'timed_out')
          AND episode.hard_until > LEAST(${acceptedAt}, v.expires_at,
            experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
      ) AS pending_deadlines
    FROM recommendation_precomputed_visit v
    JOIN recommendation_precomputed_experiment experiment ON experiment.id = v.experiment_id
    LEFT JOIN recommendation_precomputed_ctr_policy policy ON policy.experiment_id = v.experiment_id
    LEFT JOIN recommendation_precomputed_visit_request link ON link.visit_id = v.id
    LEFT JOIN recommendation_selection selection ON selection.request_id = link.request_id
      AND selection.received_at >= link.created_at
      AND selection.received_at <= LEAST(${acceptedAt}, v.expires_at,
        experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
    LEFT JOIN recommendation_playback_episode episode ON episode.selection_id = selection.id
      AND episode.request_id = selection.request_id AND episode.item_id = selection.item_id
      AND episode.claimed_at >= selection.received_at
      AND episode.claimed_at <= LEAST(${acceptedAt}, v.expires_at,
        experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
      AND episode.discovery_source = 'recommendation'
    WHERE v.id = ${visitId}::uuid
    GROUP BY v.expires_at, experiment.ends_at, policy.late_event_cutoff_hours
  `)
  if (!pending) throw new Error("precomputed_compact_pending_mismatch")
  const cutoffCeiling = pending.cutoff_ceiling_at.getTime()
  const summary = JSON.stringify(
    {
      ...derived,
      pending_deadlines: (pending.pending_deadlines ?? []).map((date) =>
        date.toISOString(),
      ),
      captured_cutoff_at: new Date(
        Math.min(acceptedAt.getTime(), cutoffCeiling),
      ).toISOString(),
      cutoff_ceiling_at: pending.cutoff_ceiling_at.toISOString(),
    },
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
  )
  const [latest] = await tx.$queryRaw<Array<{ revision: number }>>(Prisma.sql`
    SELECT revision FROM recommendation_precomputed_ctr_measurement
    WHERE visit_id = ${visitId}::uuid ORDER BY revision DESC LIMIT 1
  `)
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO recommendation_precomputed_ctr_measurement
      (visit_id, revision, accepted_at, summary)
    VALUES (${visitId}::uuid, ${(latest?.revision ?? 0) + 1},
      ${acceptedAt}, ${summary}::jsonb)
  `)
}

/** Resolve only the short-lived operational link; never copy its request ID. */
export async function capturePrecomputedCtrMeasurementForRequest(
  tx: Prisma.TransactionClient,
  requestId: string,
  acceptedAt: Date,
): Promise<void> {
  if (env.RECOMMENDATION_PRECOMPUTED_COMPACT_MEASUREMENT_ENABLED !== "1") return
  const [link] = await tx.$queryRaw<Array<{ visit_id: string }>>(Prisma.sql`
    SELECT visit_id FROM recommendation_precomputed_visit_request
    WHERE request_id = ${requestId}
  `)
  if (link)
    await capturePrecomputedCtrMeasurement(tx, link.visit_id, acceptedAt)
}

/** Qualification read: a report cutoff sees only previously accepted state. */
export async function readPrecomputedCtrMeasurementAt(
  prisma: PrismaClient,
  visitId: string,
  asOf: Date,
): Promise<{ revision: number; acceptedAt: Date; summary: unknown } | null> {
  const [row] = await prisma.$queryRaw<
    Array<{ revision: number; accepted_at: Date; summary: unknown }>
  >(Prisma.sql`
    SELECT revision, accepted_at, summary
    FROM recommendation_precomputed_ctr_measurement
    WHERE visit_id = ${visitId}::uuid AND accepted_at <= ${asOf}
    ORDER BY accepted_at DESC, revision DESC LIMIT 1
  `)
  return row
    ? {
        revision: row.revision,
        acceptedAt: row.accepted_at,
        summary: advanceCompactPendingCutoff(row.summary, asOf),
      }
    : null
}

export function advanceCompactPendingCutoff(
  summary: unknown,
  asOf: Date,
): Record<string, unknown> {
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    throw new Error("precomputed_compact_summary_invalid")
  const state = summary as Record<string, unknown>
  if (
    typeof state.pending_playbacks !== "string" ||
    !Array.isArray(state.pending_deadlines) ||
    typeof state.captured_cutoff_at !== "string" ||
    typeof state.cutoff_ceiling_at !== "string"
  )
    throw new Error("precomputed_compact_summary_invalid")
  const captured = Date.parse(state.captured_cutoff_at)
  const cutoff = Math.min(asOf.getTime(), Date.parse(state.cutoff_ceiling_at))
  const pending = Number(state.pending_playbacks)
  if (
    !Number.isSafeInteger(pending) ||
    !Number.isFinite(captured) ||
    !Number.isFinite(cutoff) ||
    cutoff < captured
  )
    throw new Error("precomputed_compact_summary_invalid")
  const elapsed = state.pending_deadlines.filter((deadline) => {
    if (typeof deadline !== "string" || !Number.isFinite(Date.parse(deadline)))
      throw new Error("precomputed_compact_summary_invalid")
    const at = Date.parse(deadline)
    return at > captured && at <= cutoff
  }).length
  if (elapsed > pending) throw new Error("precomputed_compact_summary_invalid")
  return { ...state, pending_playbacks: String(pending - elapsed) }
}
