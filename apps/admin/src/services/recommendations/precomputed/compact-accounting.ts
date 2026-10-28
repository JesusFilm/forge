import { Prisma, type PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { RecommendationInternalStateError } from "../errors"
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
  const [latest] = await tx.$queryRaw<
    Array<{ revision: number; accepted_at: Date }>
  >(Prisma.sql`
    SELECT revision, accepted_at FROM recommendation_precomputed_ctr_measurement
    WHERE visit_id = ${visitId}::uuid ORDER BY revision DESC LIMIT 1
  `)
  // The visit lock serializes captures. A callback that waited behind a later
  // clock cannot backdate its accepted revision before the committed one.
  const effectiveAcceptedAt =
    latest && latest.accepted_at > acceptedAt ? latest.accepted_at : acceptedAt
  const rows = await tx.$queryRaw<RawCtrVisit[]>(
    rawCtrVisitSql(Prisma.sql`v.id = ${visitId}::uuid`, effectiveAcceptedAt),
  )
  if (rows.length !== 1)
    throw new RecommendationInternalStateError(
      "precomputed_compact_visit_mismatch",
    )
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
          AND episode.hard_until > LEAST(${effectiveAcceptedAt}, v.expires_at,
            experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
      ) AS pending_deadlines
    FROM recommendation_precomputed_visit v
    JOIN recommendation_precomputed_experiment experiment ON experiment.id = v.experiment_id
    LEFT JOIN recommendation_precomputed_ctr_policy policy ON policy.experiment_id = v.experiment_id
    LEFT JOIN recommendation_precomputed_visit_request link ON link.visit_id = v.id
    LEFT JOIN recommendation_selection selection ON selection.request_id = link.request_id
      AND selection.received_at >= link.created_at
      AND selection.received_at <= LEAST(${effectiveAcceptedAt}, v.expires_at,
        experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
    LEFT JOIN recommendation_playback_episode episode ON episode.selection_id = selection.id
      AND episode.request_id = selection.request_id AND episode.item_id = selection.item_id
      AND episode.claimed_at >= selection.received_at
      AND episode.claimed_at <= LEAST(${effectiveAcceptedAt}, v.expires_at,
        experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour')
      AND episode.discovery_source = 'recommendation'
    WHERE v.id = ${visitId}::uuid
    GROUP BY v.expires_at, experiment.ends_at, policy.late_event_cutoff_hours
  `)
  if (!pending)
    throw new RecommendationInternalStateError(
      "precomputed_compact_pending_mismatch",
    )
  const cutoffCeiling = pending.cutoff_ceiling_at.getTime()
  const summary = JSON.stringify(
    {
      ...derived,
      pending_deadlines: (pending.pending_deadlines ?? []).map((date) =>
        date.toISOString(),
      ),
      captured_cutoff_at: new Date(
        Math.min(effectiveAcceptedAt.getTime(), cutoffCeiling),
      ).toISOString(),
      cutoff_ceiling_at: pending.cutoff_ceiling_at.toISOString(),
    },
    (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
  )
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO recommendation_precomputed_ctr_measurement
      (visit_id, revision, accepted_at, summary)
    VALUES (${visitId}::uuid, ${(latest?.revision ?? 0) + 1},
      ${effectiveAcceptedAt}, ${summary}::jsonb)
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

/** A checkpoint only covers live visits whose own revision was accepted by
 * the requested cutoff. Archived totals are evaluated by the report reader. */
export async function qualifyCompactCtrCoverageAt(
  prisma: PrismaClient,
  experimentId: string,
  asOf: Date,
): Promise<
  | { status: "available"; liveVisits: bigint; missingSnapshots: 0n }
  | {
      status: "unavailable"
      reason: "missing_live_snapshot"
      liveVisits: bigint
      missingSnapshots: bigint
    }
> {
  const [row] = await prisma.$queryRaw<
    Array<{ live_visits: bigint; missing_snapshots: bigint }>
  >(Prisma.sql`
    SELECT count(*) AS live_visits,
      count(*) FILTER (WHERE accepted.visit_id IS NULL) AS missing_snapshots
    FROM recommendation_precomputed_visit v
    LEFT JOIN LATERAL (
      SELECT visit_id FROM recommendation_precomputed_ctr_measurement
      WHERE visit_id = v.id AND accepted_at <= ${asOf}
      ORDER BY accepted_at DESC, revision DESC LIMIT 1
    ) accepted ON true
    WHERE v.experiment_id = ${experimentId} AND v.created_at <= ${asOf}
  `)
  if (!row)
    throw new RecommendationInternalStateError(
      "precomputed_compact_coverage_missing",
    )
  return row.missing_snapshots === 0n
    ? { status: "available", liveVisits: row.live_visits, missingSnapshots: 0n }
    : {
        status: "unavailable",
        reason: "missing_live_snapshot",
        liveVisits: row.live_visits,
        missingSnapshots: row.missing_snapshots,
      }
}

/** Qualification decoder for a live visit. Missing pre-cutover snapshots stay
 * missing; this never infers past acceptance from current operational state. */
export async function readCompactCtrVisitAt(
  prisma: PrismaClient,
  visitId: string,
  asOf: Date,
): Promise<RawCtrVisit | null> {
  const [row] = await prisma.$queryRaw<
    Array<{
      visit_id: string
      experiment_id: string
      browser_unit_digest: string | null
      summary: unknown
    }>
  >(Prisma.sql`
    SELECT v.id AS visit_id, v.experiment_id, v.browser_unit_digest,
      measurement.summary
    FROM recommendation_precomputed_visit v
    JOIN LATERAL (
      SELECT summary FROM recommendation_precomputed_ctr_measurement
      WHERE visit_id = v.id AND accepted_at <= ${asOf}
      ORDER BY accepted_at DESC, revision DESC LIMIT 1
    ) measurement ON true
    WHERE v.id = ${visitId}::uuid AND v.created_at <= ${asOf}
  `)
  if (!row) return null
  const state = advanceCompactPendingCutoff(row.summary, asOf)
  const string = (key: string): string => {
    const value = state[key]
    if (typeof value !== "string")
      throw new RecommendationInternalStateError(
        "precomputed_compact_summary_invalid",
      )
    return value
  }
  const nullableString = (key: string): string | null => {
    const value = state[key]
    if (value !== null && typeof value !== "string")
      throw new RecommendationInternalStateError(
        "precomputed_compact_summary_invalid",
      )
    return value
  }
  const boolean = (key: string): boolean => {
    const value = state[key]
    if (typeof value !== "boolean")
      throw new RecommendationInternalStateError(
        "precomputed_compact_summary_invalid",
      )
    return value
  }
  const count = (key: string): bigint => {
    const value = string(key)
    if (!/^(0|[1-9][0-9]*)$/.test(value))
      throw new RecommendationInternalStateError(
        "precomputed_compact_summary_invalid",
      )
    return BigInt(value)
  }
  return {
    visit_id: row.visit_id,
    experiment_id: row.experiment_id,
    browser_unit_digest: row.browser_unit_digest,
    arm: nullableString("arm"),
    eligibility: string("eligibility"),
    qualification: string("qualification"),
    exclusion_reason: nullableString("exclusion_reason"),
    delivery_result: string("delivery_result"),
    accepted_selections: count("accepted_selections"),
    qualified_impressions: count("qualified_impressions"),
    matched_selections: count("matched_selections"),
    actual_fallback: boolean("actual_fallback"),
    private_recovery_attempt: boolean("private_recovery_attempt"),
    unlinked_delivered: boolean("unlinked_delivered"),
    unversioned: boolean("unversioned"),
    qualified_playbacks: count("qualified_playbacks"),
    active_playback_milliseconds: count("active_playback_milliseconds"),
    claimed_playbacks: count("claimed_playbacks"),
    observed_playbacks: count("observed_playbacks"),
    complete_playbacks: count("complete_playbacks"),
    partial_playbacks: count("partial_playbacks"),
    missing_outcome_playbacks: count("missing_outcome_playbacks"),
    missing_coverage_playbacks: count("missing_coverage_playbacks"),
    pending_playbacks: count("pending_playbacks"),
    invalid_playbacks: count("invalid_playbacks"),
  }
}

export function advanceCompactPendingCutoff(
  summary: unknown,
  asOf: Date,
): Record<string, unknown> {
  if (!summary || typeof summary !== "object" || Array.isArray(summary))
    throw new RecommendationInternalStateError(
      "precomputed_compact_summary_invalid",
    )
  const state = summary as Record<string, unknown>
  if (
    typeof state.pending_playbacks !== "string" ||
    !Array.isArray(state.pending_deadlines) ||
    typeof state.captured_cutoff_at !== "string" ||
    typeof state.cutoff_ceiling_at !== "string"
  )
    throw new RecommendationInternalStateError(
      "precomputed_compact_summary_invalid",
    )
  const captured = Date.parse(state.captured_cutoff_at)
  const cutoff = Math.min(asOf.getTime(), Date.parse(state.cutoff_ceiling_at))
  const pending = Number(state.pending_playbacks)
  if (
    !Number.isSafeInteger(pending) ||
    !Number.isFinite(captured) ||
    !Number.isFinite(cutoff) ||
    cutoff < captured
  )
    throw new RecommendationInternalStateError(
      "precomputed_compact_summary_invalid",
    )
  const elapsed = state.pending_deadlines.filter((deadline) => {
    if (typeof deadline !== "string" || !Number.isFinite(Date.parse(deadline)))
      throw new RecommendationInternalStateError(
        "precomputed_compact_summary_invalid",
      )
    const at = Date.parse(deadline)
    return at > captured && at <= cutoff
  }).length
  if (elapsed > pending)
    throw new RecommendationInternalStateError(
      "precomputed_compact_summary_invalid",
    )
  return { ...state, pending_playbacks: String(pending - elapsed) }
}
