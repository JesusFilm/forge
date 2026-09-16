import { Prisma, type PrismaClient } from "@prisma/client"
import { ACTIVE_WATCH_PROXY_VERSION } from "../contracts"
import {
  RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD,
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
} from "../integrity-policy"
import { readRecommendationRetentionHealth } from "../retention.service"
import { VIEWING_MODE_VERSION } from "../viewing-mode"
import {
  PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION,
  PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION,
} from "./assignment"
import {
  evaluateUsefulnessSnapshot,
  type UsefulnessSnapshot,
} from "./usefulness-offline"

type UnitRow = {
  unitDigest: string
  unitKind: string
  arm: "control" | "challenger"
  assignedAt: Date
  qualifiedViews: number
  claimedEpisodes: number
  missingActiveEpisodes: number
  unresolvedEpisodes: number
  conflictingOutcomes: number
  contaminated: boolean
  fenced: boolean
  requestCount: number
  unmatchedExposures: number
}

/** Privileged offline reader. No enrollment, approval, or serving mutations. */
export async function extractUsefulnessSnapshot(
  prisma: PrismaClient,
  input: {
    experimentId: string
    configurationDigest: string
    enrollmentStart: Date
    enrollmentEnd: Date
    plannedAssignmentsPerArm: number
    minimumUsefulDelta: number
  },
) {
  if (
    !/^[a-zA-Z0-9_-]{1,191}$/.test(input.experimentId) ||
    !/^[a-f0-9]{64}$/.test(input.configurationDigest) ||
    !Number.isFinite(input.enrollmentStart.getTime()) ||
    !Number.isFinite(input.enrollmentEnd.getTime()) ||
    input.enrollmentEnd <= input.enrollmentStart ||
    input.enrollmentEnd.getTime() - input.enrollmentStart.getTime() >
      14 * 86_400_000
  ) {
    throw new Error("Invalid usefulness extraction window")
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
      const [{ capturedAt }] = await tx.$queryRaw<
        Array<{ capturedAt: Date }>
      >`SELECT current_timestamp AS "capturedAt"`
      const experiment = await tx.recommendationExperiment.findUnique({
        where: { id: input.experimentId },
      })
      if (
        !experiment ||
        experiment.configurationDigest !== input.configurationDigest ||
        experiment.assignmentPolicyVersion !==
          PROFILE_USEFULNESS_ASSIGNMENT_POLICY_VERSION ||
        experiment.outcomePolicyVersion !==
          PROFILE_USEFULNESS_OUTCOME_POLICY_VERSION ||
        experiment.challengerProbability !== 0.5 ||
        input.enrollmentStart.getTime() !== experiment.startsAt.getTime() ||
        input.enrollmentEnd.getTime() !== experiment.endsAt.getTime()
      ) {
        throw new Error("Usefulness experiment configuration does not match")
      }
      const rows = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
      WITH assignments AS MATERIALIZED (
        SELECT assignment.*, profile.state AS profile_state,
          profile.privacy_generation AS current_privacy_generation,
          profile.expires_at AS profile_expires_at
        FROM recommendation_experiment_assignment assignment
        LEFT JOIN recommendation_profile profile ON profile.id = assignment.profile_id
        WHERE assignment.experiment_id = ${input.experimentId}
          AND assignment.assigned_at >= ${input.enrollmentStart}
          AND assignment.assigned_at < ${input.enrollmentEnd}
        ORDER BY assignment.assigned_at, assignment.id LIMIT 100001
      )
      SELECT assignment.unit_digest AS "unitDigest", assignment.unit_kind::text AS "unitKind",
        assignment.arm::text AS arm, assignment.assigned_at AS "assignedAt",
        (assignment.state <> 'active' OR assignment.expires_at <= ${capturedAt}
          OR assignment.profile_state IS DISTINCT FROM 'active'
          OR assignment.current_privacy_generation IS DISTINCT FROM assignment.privacy_generation
          OR assignment.profile_expires_at <= ${capturedAt}) AS fenced,
        (assignment.configuration_digest <> ${input.configurationDigest}
          OR assignment.generation <> ${experiment.generation}
          OR assignment.assignment_probability <> 0.5
          OR stats.contaminated > 0) AS contaminated,
        stats."requestCount", stats."unmatchedExposures",
        outcomes."qualifiedViews", outcomes."claimedEpisodes", outcomes."missingActiveEpisodes",
        outcomes."unresolvedEpisodes", outcomes."conflictingOutcomes"
      FROM assignments assignment
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS "requestCount",
          count(*) FILTER (WHERE request.locale <> 'en' OR candidate.id IS NULL OR decision.effective_manifest_id IS DISTINCT FROM
            CASE WHEN assignment.arm = 'control' THEN ${experiment.controlManifestId} ELSE ${experiment.challengerManifestId} END
            OR candidate.ranker_version = 'viewing-mode-affinity-v1'
            OR (CASE WHEN assignment.arm = 'control' THEN ${experiment.controlManifestId} ELSE ${experiment.challengerManifestId} END
              <> 'semantic-profile-hybrid-v1' AND decision.execution_mode = 'hybrid_personalized'))::int AS contaminated,
          (SELECT count(*)::int FROM recommendation_impression impression
            JOIN recommendation_request root ON root.id = impression.request_id
            LEFT JOIN recommendation_experiment_exposure exposure ON exposure.item_id = impression.item_id AND exposure.request_id = impression.request_id
            WHERE root.experiment_assignment_id = assignment.id
              AND root.created_at >= assignment.assigned_at AND root.created_at < assignment.assigned_at + interval '24 hours'
              AND impression.received_at <= ${capturedAt} AND exposure.id IS NULL) AS "unmatchedExposures"
        FROM recommendation_request request
        LEFT JOIN recommendation_personalization_decision decision ON decision.request_id = request.id
        LEFT JOIN recommendation_candidate_run candidate ON candidate.request_id = request.id
        WHERE request.experiment_assignment_id = assignment.id
          AND request.created_at >= assignment.assigned_at AND request.created_at < assignment.assigned_at + interval '24 hours'
      ) stats
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE clean AND attributed AND (
            (outcome.qualified_view AND eligibility.state = 'eligible' AND 'experiment' = ANY(eligibility.eligible_scopes))
            OR mode.sound_off_qualified OR mode.sound_on_qualified))::int AS "qualifiedViews",
          count(*) FILTER (WHERE episode.claimed_at IS NOT NULL)::int AS "claimedEpisodes",
          count(*) FILTER (WHERE episode.claimed_at IS NOT NULL AND COALESCE(outcome.active_coverage, 'missing') = 'missing'
            AND COALESCE(mode.sound_off_milliseconds + mode.sound_on_milliseconds, 0) = 0)::int AS "missingActiveEpisodes",
          count(*) FILTER (WHERE episode.claimed_at IS NOT NULL AND
            (episode.hard_until > ${capturedAt} OR outcome.id IS NULL))::int AS "unresolvedEpisodes",
          count(*) FILTER (WHERE episode.conflict_count > 0)::int AS "conflictingOutcomes"
        FROM recommendation_request request
        JOIN recommendation_playback_episode episode ON episode.request_id = request.id
        JOIN recommendation_selection selection ON selection.id = episode.selection_id
        LEFT JOIN LATERAL (
          SELECT revision.* FROM recommendation_outcome_revision revision
          WHERE revision.episode_id = episode.id AND revision.classifier_version = ${ACTIVE_WATCH_PROXY_VERSION}
            AND revision.created_at <= ${capturedAt} AND revision.expires_at > ${capturedAt}
          ORDER BY revision.revision DESC LIMIT 1
        ) outcome ON true
        LEFT JOIN LATERAL (
          SELECT decision.* FROM recommendation_eligibility_decision decision
          WHERE decision.source_key = 'playback_outcome:' || outcome.id AND decision.decided_at <= ${capturedAt}
            AND decision.policy_version = ${RECOMMENDATION_INTEGRITY_POLICY_VERSION} AND decision.expires_at > ${capturedAt}
          ORDER BY decision.revision DESC LIMIT 1
        ) eligibility ON true
        LEFT JOIN recommendation_viewing_mode_evidence mode ON mode.episode_id = episode.id
          AND mode.profile_id = assignment.profile_id AND mode.privacy_generation = assignment.privacy_generation
          AND mode.policy_version = ${VIEWING_MODE_VERSION} AND mode.expires_at > ${capturedAt}
          AND mode.observed_at <= ${capturedAt}
        CROSS JOIN LATERAL (SELECT
          episode.conflict_count = 0 AND episode.replay_count < ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
            AND episode.expires_at > ${capturedAt}
            AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact fact WHERE fact.episode_id = episode.id AND (fact.late OR fact.kind = 'playback_error'))
            AND NOT EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence fence WHERE fence.request_id = request.id) AS clean,
          selection.attribution_eligible_at <= ${capturedAt} AS attributed
        ) integrity
        WHERE request.experiment_assignment_id = assignment.id
          AND request.state = 'issued'
          AND request.created_at >= assignment.assigned_at AND request.created_at < assignment.assigned_at + interval '24 hours'
          AND selection.occurred_at >= assignment.assigned_at AND selection.occurred_at < assignment.assigned_at + interval '24 hours'
          AND episode.created_at <= ${capturedAt}
      ) outcomes
    `)
      if (
        rows.length > 100_000 ||
        rows.some((row) => row.unitKind !== "anonymous_profile")
      ) {
        throw new Error(
          "Usefulness assignment cohort is oversized or incompatible",
        )
      }
      const sum = (
        key:
          | "qualifiedViews"
          | "claimedEpisodes"
          | "missingActiveEpisodes"
          | "unresolvedEpisodes"
          | "conflictingOutcomes"
          | "requestCount"
          | "unmatchedExposures",
      ) => rows.reduce((total, row) => total + row[key], 0)
      const retention = await readRecommendationRetentionHealth(
        tx as unknown as PrismaClient,
        capturedAt,
      )
      const snapshot: UsefulnessSnapshot = {
        schemaVersion: "recommendation-usefulness-offline-v2",
        experimentId: input.experimentId,
        configurationDigest: input.configurationDigest,
        enrollmentStart: input.enrollmentStart.toISOString(),
        enrollmentEnd: input.enrollmentEnd.toISOString(),
        capturedAt: capturedAt.toISOString(),
        plannedAssignmentsPerArm: input.plannedAssignmentsPerArm,
        minimumUsefulDelta: input.minimumUsefulDelta,
        health: {
          assignmentLedgerCount: rows.length,
          claimedEpisodes: sum("claimedEpisodes"),
          missingActiveEpisodes: sum("missingActiveEpisodes"),
          unresolvedEpisodes: sum("unresolvedEpisodes"),
          conflictingOutcomes: sum("conflictingOutcomes"),
          contaminatedAssignments: rows.filter((row) => row.contaminated)
            .length,
          fencedAssignments: rows.filter((row) => row.fenced).length,
          routingVerified:
            sum("requestCount") > 0 && rows.every((row) => !row.contaminated),
          collectionHealthy:
            sum("requestCount") > 0 && sum("unmatchedExposures") === 0,
          retentionHealthy: retention.healthy,
          // The ledger cannot attest to a profile A/A or external HTTP/latency
          // guardrails. Fail closed until separately reviewed evidence is joined.
          aaPassed: false,
          guardrailsPassed: false,
        },
        units: rows.map((row) => ({
          unitDigest: row.unitDigest,
          unitKind: "anonymous_profile",
          arm: row.arm,
          assignedAt: row.assignedAt.toISOString(),
          qualifiedViews:
            row.fenced || row.contaminated ? 0 : row.qualifiedViews,
        })),
      }
      return {
        snapshot,
        assessment: evaluateUsefulnessSnapshot(snapshot),
        externalEvidenceRequired: [
          "profile_unit_aa_with_viewing_mode_v2",
          "http_error_latency_guardrails",
        ],
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20_000,
      maxWait: 2_000,
    },
  )
}
