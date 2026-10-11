import { Prisma } from "@prisma/client"

export type RawCtrVisit = {
  visit_id: string
  experiment_id: string
  browser_unit_digest: string | null
  arm: string | null
  eligibility: string
  qualification: string
  exclusion_reason: string | null
  delivery_result: string
  accepted_selections: bigint
  qualified_impressions: bigint
  matched_selections: bigint
  actual_fallback: boolean
  private_recovery_attempt: boolean
  unlinked_delivered: boolean
  unversioned: boolean
}

/** The same attribution query feeds raw reports and the one-way archive. A
 * selection belongs to its server-bound request and is counted once per visit;
 * the server receipt must precede the declared cutoff and raw visit expiry. */
export function rawCtrVisitSql(where: Prisma.Sql, asOf: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT v.id AS visit_id, v.experiment_id, v.browser_unit_digest,
      v.arm::text AS arm, v.eligibility, v.qualification,
      v.exclusion_reason, v.delivery_result,
      counts.accepted_selections, counts.qualified_impressions,
      counts.matched_selections,
      (v.delivery_result = 'fallback' OR (
        v.arm = 'challenger' AND EXISTS (
          SELECT 1 FROM recommendation_precomputed_visit_request fallback_link
          JOIN recommendation_request fallback_request ON fallback_request.id = fallback_link.request_id
          WHERE fallback_link.visit_id = v.id
            AND fallback_request.manifest_id <> experiment.challenger_manifest_id
        )
      )) AS actual_fallback,
      (v.fallback_reason IS NOT NULL) AS private_recovery_attempt,
      (v.delivery_result IN ('served', 'fallback') AND NOT EXISTS (
        SELECT 1 FROM recommendation_precomputed_visit_request any_link
        WHERE any_link.visit_id = v.id
      )) AS unlinked_delivered,
      (policy.experiment_id IS NULL) AS unversioned
    FROM recommendation_precomputed_visit v
    JOIN recommendation_precomputed_experiment experiment ON experiment.id = v.experiment_id
    LEFT JOIN recommendation_precomputed_ctr_policy policy ON policy.experiment_id = v.experiment_id
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT selection.id) AS accepted_selections,
        count(DISTINCT impression.id) AS qualified_impressions,
        count(DISTINCT selection.id) FILTER (WHERE impression.id IS NOT NULL)
          AS matched_selections
      FROM recommendation_precomputed_visit_request link
      JOIN recommendation_served_item item ON item.request_id = link.request_id
      LEFT JOIN recommendation_selection selection ON selection.item_id = item.id
        AND selection.received_at >= link.created_at
        AND selection.received_at <= LEAST(
          ${asOf}, v.expires_at,
          experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour'
        )
      LEFT JOIN recommendation_impression impression ON impression.item_id = item.id
        AND impression.received_at <= LEAST(
          ${asOf}, v.expires_at,
          experiment.ends_at + COALESCE(policy.late_event_cutoff_hours, 672) * interval '1 hour'
        )
      WHERE link.visit_id = v.id
    ) counts ON true
    WHERE ${where}
  `
}

export const ctrTotalFields = [
  "eligibleVisits",
  "clickedVisits",
  "acceptedSelections",
  "qualifiedImpressions",
  "matchedSelections",
  "servedVisits",
  "emptyVisits",
  "unavailableVisits",
  "notAttemptedVisits",
  "actualFallbackVisits",
  "privateRecoveryAttemptVisits",
  "unlinkedDeliveredVisits",
  "excludedAutomation",
  "excludedPreview",
  "excludedUnknown",
  "excludedOutsideCohort",
  "excludedOther",
  "unversionedArchivedVisits",
] as const
export type CtrTotals = Record<(typeof ctrTotalFields)[number], bigint>

export function blankCtrTotals(): CtrTotals {
  return Object.fromEntries(
    ctrTotalFields.map((field) => [field, 0n]),
  ) as CtrTotals
}

export function addCtrVisit(totals: CtrTotals, row: RawCtrVisit): void {
  if (row.unversioned) totals.unversionedArchivedVisits += 1n
  if (row.eligibility !== "eligible") {
    if (row.qualification === "declared_automation")
      totals.excludedAutomation += 1n
    else if (row.qualification === "private_preview")
      totals.excludedPreview += 1n
    else if (row.qualification === "unknown_signal")
      totals.excludedUnknown += 1n
    else if (row.exclusion_reason === "outside_frozen_cohort")
      totals.excludedOutsideCohort += 1n
    else totals.excludedOther += 1n
    return
  }
  totals.eligibleVisits += 1n
  if (row.accepted_selections > 0n) totals.clickedVisits += 1n
  totals.acceptedSelections += row.accepted_selections
  totals.qualifiedImpressions += row.qualified_impressions
  totals.matchedSelections += row.matched_selections
  if (row.delivery_result === "served") totals.servedVisits += 1n
  if (row.delivery_result === "empty") totals.emptyVisits += 1n
  if (row.delivery_result === "unavailable") totals.unavailableVisits += 1n
  if (row.delivery_result === "not_attempted") totals.notAttemptedVisits += 1n
  if (row.actual_fallback) totals.actualFallbackVisits += 1n
  if (row.private_recovery_attempt) totals.privateRecoveryAttemptVisits += 1n
  if (row.unlinked_delivered) totals.unlinkedDeliveredVisits += 1n
}

/** Called inside the ordinary retention transaction, before any raw visit or
 * request is deleted. Its caller holds the exclusive experiment fence. */
export async function archivePrecomputedCtrVisits(
  tx: Prisma.TransactionClient,
  visits: readonly { id: string; experimentId: string }[],
  now: Date,
): Promise<void> {
  if (visits.length === 0) return
  const ids = visits.map((visit) => visit.id)
  const rows = await tx.$queryRaw<RawCtrVisit[]>(
    rawCtrVisitSql(Prisma.sql`v.id = ANY(${ids}::uuid[])`, now),
  )
  if (rows.length !== visits.length)
    throw new Error("precomputed_ctr_archive_visit_mismatch")
  const inserted = await tx.$queryRaw<Array<{ visit_id: string }>>(Prisma.sql`
    INSERT INTO recommendation_precomputed_ctr_archived_visit (visit_id, experiment_id)
    SELECT v.id, v.experiment_id FROM recommendation_precomputed_visit v
    WHERE v.id = ANY(${ids}::uuid[])
    ON CONFLICT DO NOTHING RETURNING visit_id
  `)
  if (inserted.length !== rows.length)
    throw new Error("precomputed_ctr_archive_replay_mismatch")

  const totals = new Map<
    string,
    { experimentId: string; arm: string; value: CtrTotals }
  >()
  const clusters = new Map<
    string,
    {
      experimentId: string
      digest: string
      arm: "control" | "challenger"
      visits: bigint
      clicks: bigint
    }
  >()
  for (const row of rows) {
    const arm = row.eligibility === "eligible" ? row.arm : "excluded"
    if (arm !== "control" && arm !== "challenger" && arm !== "excluded")
      throw new Error("precomputed_ctr_archive_invalid_arm")
    const totalKey = `${row.experiment_id}\0${arm}`
    let total = totals.get(totalKey)
    if (!total) {
      total = { experimentId: row.experiment_id, arm, value: blankCtrTotals() }
      totals.set(totalKey, total)
    }
    addCtrVisit(total.value, row)
    if (arm === "excluded") continue
    if (!row.browser_unit_digest)
      throw new Error("precomputed_ctr_archive_missing_browser")
    const key = `${row.experiment_id}\0${row.browser_unit_digest}`
    let cluster = clusters.get(key)
    if (!cluster) {
      cluster = {
        experimentId: row.experiment_id,
        digest: row.browser_unit_digest,
        arm,
        visits: 0n,
        clicks: 0n,
      }
      clusters.set(key, cluster)
    }
    if (cluster.arm !== arm)
      throw new Error("precomputed_ctr_archive_cluster_arm_conflict")
    cluster.visits += 1n
    if (row.accepted_selections > 0n) cluster.clicks += 1n
  }
  for (const cluster of clusters.values()) {
    const changed = await tx.$executeRaw(Prisma.sql`
      INSERT INTO recommendation_precomputed_ctr_cluster
        (experiment_id, browser_unit_digest, arm, eligible_visits, clicked_visits)
      VALUES (${cluster.experimentId}, ${cluster.digest}, ${cluster.arm}::"RecommendationExperimentArm",
        ${cluster.visits}, ${cluster.clicks})
      ON CONFLICT (experiment_id, browser_unit_digest) DO UPDATE SET
        eligible_visits = recommendation_precomputed_ctr_cluster.eligible_visits + EXCLUDED.eligible_visits,
        clicked_visits = recommendation_precomputed_ctr_cluster.clicked_visits + EXCLUDED.clicked_visits
      WHERE recommendation_precomputed_ctr_cluster.arm = EXCLUDED.arm
    `)
    if (changed !== 1)
      throw new Error("precomputed_ctr_archive_cluster_arm_conflict")
  }
  for (const total of totals.values()) {
    const initial = total.value
    await tx.recommendationPrecomputedCtrTotals.upsert({
      where: {
        experimentId_arm: { experimentId: total.experimentId, arm: total.arm },
      },
      create: { experimentId: total.experimentId, arm: total.arm, ...initial },
      update: Object.fromEntries(
        ctrTotalFields.map((field) => [field, { increment: initial[field] }]),
      ),
    })
  }
}
