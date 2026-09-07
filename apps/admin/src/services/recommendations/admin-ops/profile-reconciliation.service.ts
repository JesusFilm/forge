import { Prisma, type PrismaClient } from "@prisma/client"
import { RECOMMENDATION_INTEGRITY_POLICY_VERSION } from "../integrity-policy"
import {
  profileContributionInvalidPredicateSql,
  profileLineageEligibleSql,
} from "../profiles/profile-lineage"
import type { RecommendationOpsWindow } from "./shared"

const SMALL_COHORT_MINIMUM = 3

type ReconciliationRow = Readonly<{
  ineligibleGenerations: bigint | number
  affectedPointers: bigint | number
  affectedContributions: bigint | number
  rebuildCandidates: bigint | number
  rebuildBacklog: bigint | number
  replacementPublications: bigint | number
  staleClaims: bigint | number
  reclaimedRuns: bigint | number
  terminalRuns: bigint | number
  servingFences: bigint | number
  affectedRequests: bigint | number
  cleanHybridRequests: bigint | number
  reasonCounts: unknown
}>

export type RecommendationProfileReconciliationOverview = Readonly<{
  state: "healthy" | "repairing" | "degraded" | "suppressed"
  suppressed: boolean
  currentPointerInvariant: "clean" | "violated"
  counts: Readonly<{
    ineligibleGenerations: number
    affectedPointers: number
    affectedContributions: number
    rebuildCandidates: number
    rebuildBacklog: number
    replacementPublications: number
    staleClaims: number
    reclaimedRuns: number
    terminalRuns: number
    servingFences: number
    affectedRequests: number
    cleanHybridRequests: number
  }> | null
  reasonCodes: ReadonlyArray<Readonly<{ reasonCode: string; count: number }>>
}>

export async function loadRecommendationProfileReconciliationOverview(
  prisma: Pick<PrismaClient, "$queryRaw">,
  window: RecommendationOpsWindow,
  now: Date,
): Promise<RecommendationProfileReconciliationOverview | null> {
  const rows = await prisma.$queryRaw<ReconciliationRow[]>(Prisma.sql`
    WITH current_pointer AS (
      SELECT
        pointer.scope_digest,
        pointer.generation_id,
        pointer.pointer_generation,
        pointer.updated_at
      FROM recommendation_profile_projection_pointer pointer
      JOIN recommendation_profile_projection_generation generation
        ON generation.id = pointer.generation_id
      WHERE generation.state = 'published'
        AND generation.expires_at > ${now}
    ), affected_pointer AS (
      SELECT pointer.*
      FROM current_pointer pointer
      WHERE NOT ${profileLineageEligibleSql(Prisma.sql`pointer.generation_id`, now)}
    ), rebuild_candidate AS (
      SELECT pointer.*
      FROM affected_pointer pointer
      WHERE NOT EXISTS (
        SELECT 1
        FROM recommendation_profile_projection_run run
        WHERE run.state IN ('pending', 'claimed')
          AND run.expected_generation_id = pointer.generation_id
          AND run.expected_pointer_generation = pointer.pointer_generation
      )
    ), affected_contribution AS (
      SELECT contribution.*
      FROM recommendation_profile_projection_contribution contribution
      JOIN affected_pointer pointer
        ON pointer.generation_id = contribution.generation_id
    ), invalid_contribution AS (
      SELECT contribution.*
      FROM affected_contribution contribution
      LEFT JOIN recommendation_eligibility_decision decision
        ON decision.id = contribution.source_eligibility_decision_id
      LEFT JOIN recommendation_outcome_revision outcome
        ON outcome.id = contribution.source_outcome_id
      LEFT JOIN recommendation_playback_episode episode
        ON episode.id = outcome.episode_id
      LEFT JOIN recommendation_selection selection
        ON selection.id = contribution.source_selection_id
      LEFT JOIN recommendation_served_item selected_item
        ON selected_item.request_id = selection.request_id
        AND selected_item.id = selection.item_id
      WHERE ${profileContributionInvalidPredicateSql(now)}
    ), reason_summary AS (
      SELECT COALESCE(
        jsonb_object_agg(reason_code, reason_count ORDER BY reason_count DESC, reason_code),
        '{}'::jsonb
      ) AS counts
      FROM (
        SELECT reason_code, COUNT(*) AS reason_count
        FROM invalid_contribution contribution
        LEFT JOIN recommendation_eligibility_decision decision
          ON decision.id = contribution.source_eligibility_decision_id
          AND decision.revision = contribution.source_eligibility_revision
        CROSS JOIN LATERAL unnest(
          CASE
            WHEN decision.id IS NULL
              THEN ARRAY['eligibility_revision_missing']::text[]
            WHEN decision.is_current = false
              THEN ARRAY['eligibility_revision_superseded']::text[]
            WHEN decision.state <> 'eligible'
              THEN CASE
                WHEN cardinality(decision.reason_codes) = 0
                  THEN ARRAY['profile_scope_ineligible']::text[]
                ELSE decision.reason_codes
              END
            WHEN NOT ('profile' = ANY(decision.eligible_scopes))
              THEN ARRAY['profile_scope_ineligible']::text[]
            WHEN decision.policy_version <> ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
              OR contribution.eligibility_policy_version IS DISTINCT FROM decision.policy_version
              THEN ARRAY['eligibility_policy_version_mismatch']::text[]
            WHEN decision.expires_at <= ${now}
              THEN ARRAY['eligibility_revision_expired']::text[]
            ELSE ARRAY['source_lineage_invalid']::text[]
          END
        ) reason_code
        GROUP BY reason_code
        ORDER BY reason_count DESC, reason_code
        LIMIT 8
      ) bounded_reason
    )
    SELECT
      (SELECT COUNT(DISTINCT generation_id) FROM affected_pointer)
        AS "ineligibleGenerations",
      (SELECT COUNT(*) FROM affected_pointer) AS "affectedPointers",
      (SELECT COUNT(*) FROM invalid_contribution)
        AS "affectedContributions",
      (SELECT COUNT(*) FROM rebuild_candidate) AS "rebuildCandidates",
      (SELECT COUNT(*)
       FROM recommendation_profile_projection_run run
       WHERE run.state IN ('pending', 'claimed')
         AND run.reconciliation_cause = 'eligibility_revision'
         AND run.expires_at > ${now}) AS "rebuildBacklog",
      (SELECT COUNT(*)
       FROM recommendation_profile_projection_run run
       JOIN recommendation_profile_projection_generation generation
         ON generation.id = run.projection_id
       WHERE run.state = 'completed'
         AND run.reconciliation_cause = 'eligibility_revision'
         AND generation.state = 'published'
         AND run.completed_at >= ${window.start}
         AND run.completed_at < ${window.end}) AS "replacementPublications",
      (SELECT COUNT(*)
       FROM recommendation_profile_projection_run run
       WHERE run.state = 'claimed'
         AND run.lease_expires_at <= ${now}
         AND run.attempt_count < 3
         AND run.expires_at > ${now}) AS "staleClaims",
      (SELECT COUNT(*)
       FROM recommendation_profile_projection_run run
       WHERE run.attempt_count > 1
         AND COALESCE(run.claimed_at, run.completed_at, run.created_at) >= ${window.start}
         AND COALESCE(run.claimed_at, run.completed_at, run.created_at) < ${window.end}) AS "reclaimedRuns",
      (SELECT COUNT(*)
       FROM recommendation_profile_projection_run run
       WHERE run.state IN ('failed', 'fenced')
         AND run.completed_at >= ${window.start}
         AND run.completed_at < ${window.end}) AS "terminalRuns",
      (SELECT COUNT(*)
       FROM recommendation_candidate_run run
       WHERE run.fallback_reason = 'profile_lineage_ineligible'
         AND run.created_at >= ${window.start}
         AND run.created_at < ${window.end}
         AND run.expires_at > ${now}) AS "servingFences",
      (SELECT COUNT(DISTINCT run.request_id)
       FROM recommendation_candidate_run run
       WHERE run.fallback_reason = 'profile_lineage_ineligible'
         AND run.created_at >= ${window.start}
         AND run.created_at < ${window.end}
         AND run.expires_at > ${now}) AS "affectedRequests",
      (SELECT COUNT(*)
       FROM recommendation_personalization_decision decision
       WHERE decision.lane = 'hybrid'
         AND decision.reason_code IS NULL
         AND decision.created_at >= ${window.start}
         AND decision.created_at < ${window.end}
         AND decision.expires_at > ${now}) AS "cleanHybridRequests",
      (SELECT counts FROM reason_summary) AS "reasonCounts"
  `)
  const row = rows?.[0]
  if (!row) return null

  const counts = {
    ineligibleGenerations: count(row.ineligibleGenerations),
    affectedPointers: count(row.affectedPointers),
    affectedContributions: count(row.affectedContributions),
    rebuildCandidates: count(row.rebuildCandidates),
    rebuildBacklog: count(row.rebuildBacklog),
    replacementPublications: count(row.replacementPublications),
    staleClaims: count(row.staleClaims),
    reclaimedRuns: count(row.reclaimedRuns),
    terminalRuns: count(row.terminalRuns),
    servingFences: count(row.servingFences),
    affectedRequests: count(row.affectedRequests),
    cleanHybridRequests: count(row.cleanHybridRequests),
  }
  const reasons = reasonCounts(row.reasonCounts)
  const suppressed = [
    ...Object.values(counts),
    ...reasons.map(({ count }) => count),
  ].some((value) => value > 0 && value < SMALL_COHORT_MINIMUM)
  const state = reconciliationState(counts, suppressed)

  return {
    state,
    suppressed,
    currentPointerInvariant:
      counts.affectedPointers === 0 ? "clean" : "violated",
    counts: suppressed ? null : counts,
    reasonCodes: suppressed ? [] : reasons,
  }
}

function reconciliationState(
  counts: NonNullable<RecommendationProfileReconciliationOverview["counts"]>,
  suppressed: boolean,
): RecommendationProfileReconciliationOverview["state"] {
  if (suppressed) return "suppressed"
  if (
    counts.terminalRuns > 0 ||
    (counts.affectedPointers > 0 && counts.rebuildBacklog === 0)
  ) {
    return "degraded"
  }
  if (
    counts.affectedPointers > 0 ||
    counts.rebuildBacklog > 0 ||
    counts.staleClaims > 0
  ) {
    return "repairing"
  }
  return "healthy"
}

function count(value: bigint | number): number {
  return Number(value ?? 0)
}

function reasonCounts(
  value: unknown,
): Array<Readonly<{ reasonCode: string; count: number }>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([reasonCode, rawCount]) => {
      const value = Number(rawCount)
      if (!/^[a-z0-9_]{1,64}$/.test(reasonCode) || !Number.isFinite(value)) {
        return []
      }
      return value >= SMALL_COHORT_MINIMUM ? [{ reasonCode, count: value }] : []
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.reasonCode.localeCompare(right.reasonCode),
    )
    .slice(0, 8)
}
