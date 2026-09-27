import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import {
  RECOMMENDATION_INTEGRITY_POLICY_VERSION,
  RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD,
} from "../integrity-policy"
import {
  buildCowatchGraph,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
  type CowatchOutcome,
} from "./graph"

const MAX_SOURCE_ROWS = 50_000
const SOURCE_WINDOW_DAYS = 180
const GENERATION_RETENTION_DAYS = 29
const CLASSIFIER_VERSION = "active-watch-proxy-v1"

type SourceRow = Readonly<{
  outcomeId: string
  episodeId: string
  revision: number
  mediaId: string
  sessionDigest: string
  profileId: string | null
  occurredAt: Date
  qualityWeight: number | null
  qualified: boolean
  finalized: boolean
  integrityEligible: boolean
  eligibilityDecisionId: string | null
  eligibilityRevision: number | null
  eligibilityPolicyVersion: string | null
  expiresAt: Date
}>

/**
 * Bounded snapshot from canonical finalized outcomes. The latest classifier
 * revision is selected before eligibility, so a correction replaces rather
 * than adds to an older contribution. Suppressed outcomes never reappear after
 * a profile deletion. Aggregate scope keeps sparse anonymous identities out.
 */
export async function loadCowatchSourceRows(
  db: Pick<PrismaClient, "$queryRaw">,
  now: Date,
): Promise<SourceRow[]> {
  return db.$queryRaw<SourceRow[]>(Prisma.sql`
    WITH latest AS MATERIALIZED (
      SELECT DISTINCT ON (episode.id)
        outcome.id AS "outcomeId",
        episode.id AS "episodeId",
        outcome.revision,
        episode.media_id AS "mediaId",
        episode.session_digest AS "sessionDigest",
        COALESCE(episode.claimed_at, episode.created_at) AS "occurredAt",
        outcome.view_quality_weight AS "qualityWeight",
        outcome.fact_watermark AS "factWatermark",
        episode.next_fact_sequence AS "nextFactSequence",
        episode.conflict_count AS "conflictCount",
        episode.replay_count AS "replayCount",
        outcome.request_id AS "requestId",
        outcome.qualified_view AS qualified,
        (episode.state = 'finalized' AND episode.finalized_at IS NOT NULL) AS finalized,
        outcome.expires_at AS "expiresAt",
        episode.expires_at AS "episodeExpiresAt"
      FROM recommendation_outcome_revision outcome
      JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
      WHERE outcome.classifier_version = ${CLASSIFIER_VERSION}
        AND outcome.created_at >= ${new Date(now.getTime() - SOURCE_WINDOW_DAYS * 86_400_000)}
        AND outcome.created_at <= ${now}
      ORDER BY episode.id, outcome.revision DESC, outcome.id DESC
    )
    SELECT latest.*,
      profile.id AS "profileId",
      decision.id AS "eligibilityDecisionId",
      decision.revision AS "eligibilityRevision",
      decision.policy_version AS "eligibilityPolicyVersion",
      (
        decision.id IS NOT NULL
        AND suppression.episode_id IS NULL
        AND latest."factWatermark" = latest."nextFactSequence" - 1
        AND latest."episodeExpiresAt" > ${now}
        AND latest."conflictCount" = 0
        AND latest."replayCount" < ${RECOMMENDATION_REPLAY_QUARANTINE_THRESHOLD}
        AND NOT EXISTS (SELECT 1 FROM recommendation_playback_fact fact
          WHERE fact.episode_id = latest."episodeId" AND fact.late = true)
        AND NOT EXISTS (SELECT 1 FROM recommendation_outcome_revision newer
          WHERE newer.supersedes_id = latest."outcomeId")
        AND NOT EXISTS (SELECT 1 FROM recommendation_promotion_slate_fence fence
          WHERE fence.request_id = latest."requestId")
      ) AS "integrityEligible"
    FROM latest
    LEFT JOIN LATERAL (
      SELECT linked_profile.id
      FROM recommendation_profile_session_link link
      JOIN recommendation_profile linked_profile
        ON linked_profile.id = link.profile_id
        AND linked_profile.privacy_generation = link.privacy_generation
        AND linked_profile.state = 'active'
        AND linked_profile.expires_at > ${now}
      WHERE link.session_digest = latest."sessionDigest"
        AND link.expires_at > ${now}
      ORDER BY link.linked_at DESC, link.id DESC
      LIMIT 1
    ) profile ON true
    LEFT JOIN LATERAL (
      SELECT eligible.id, eligible.revision, eligible.policy_version
      FROM recommendation_eligibility_decision eligible
      WHERE eligible.outcome_id = latest."outcomeId"
        AND eligible.policy_version = ${RECOMMENDATION_INTEGRITY_POLICY_VERSION}
        AND eligible.is_current = true
        AND eligible.state = 'eligible'
        AND 'aggregate' = ANY(eligible.eligible_scopes)
        AND eligible.expires_at > ${now}
        AND eligible.source_type = 'playback_outcome'
      ORDER BY eligible.revision DESC
      LIMIT 1
    ) decision ON true
    LEFT JOIN recommendation_cowatch_suppression suppression
      ON suppression.episode_id = latest."episodeId"
    ORDER BY latest."occurredAt", latest."episodeId"
    LIMIT ${MAX_SOURCE_ROWS + 1}
  `)
}

export type CowatchPublication = Readonly<{
  status: "published" | "unchanged" | "source_overflow" | "work_overflow"
  generation: string | null
  sourceCount: number
  contributionCount: number
  edgeCount: number
  terminalDecision: "no_promotion"
  decisionReason: string
}>

/** Atomically publishes only a complete immutable generation, always shadow. */
export async function publishCowatchShadowGeneration(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<CowatchPublication> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '5000ms'`)
      await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '1000ms'`)
      const source = await loadCowatchSourceRows(tx, now)
      if (source.length > MAX_SOURCE_ROWS) {
        return {
          status: "source_overflow",
          generation: null,
          sourceCount: source.length,
          contributionCount: 0,
          edgeCount: 0,
          terminalDecision: "no_promotion",
          decisionReason: "source_window_exceeds_bounded_projection",
        }
      }
      const profileByOutcome = new Map(
        source.map((row) => [row.outcomeId, row.profileId]),
      )
      const rows: CowatchOutcome[] = source.map((row) => ({
        outcomeId: row.outcomeId,
        episodeId: row.episodeId,
        revision: row.revision,
        mediaId: row.mediaId,
        sessionDigest: row.sessionDigest,
        viewerKey:
          row.profileId == null
            ? `session:${row.sessionDigest}`
            : `profile:${row.profileId}`,
        occurredAt: row.occurredAt,
        qualified: row.qualified,
        finalized: row.finalized,
        integrityEligible: row.integrityEligible,
        eligibilityDecisionId: row.eligibilityDecisionId,
        eligibilityRevision: row.eligibilityRevision,
        eligibilityPolicyVersion: row.eligibilityPolicyVersion,
        qualityWeight: row.qualityWeight ?? 0,
        expiresAt: row.expiresAt,
      }))
      let graph: ReturnType<typeof buildCowatchGraph>
      try {
        graph = buildCowatchGraph(rows, now)
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        return {
          status: "work_overflow",
          generation: null,
          sourceCount: rows.length,
          contributionCount: 0,
          edgeCount: 0,
          terminalDecision: "no_promotion",
          decisionReason: "projection_work_exceeds_bound",
        }
      }
      const safeEdges = graph.edges.filter((edge) => edge.eligible)
      const decisionReason =
        graph.qualifiedOutcomes === 0
          ? "no_eligible_finalized_outcomes"
          : safeEdges.length === 0
            ? "insufficient_supported_edges"
            : "controlled_evaluation_required_feat_505"
      const existing = await tx.recommendationCowatchGeneration.findUnique({
        where: { id: graph.generation },
        select: { id: true },
      })
      if (existing) {
        return {
          status: "unchanged",
          generation: graph.generation,
          sourceCount: graph.qualifiedOutcomes,
          contributionCount: graph.contributions.length,
          edgeCount: graph.edges.length,
          terminalDecision: "no_promotion",
          decisionReason,
        }
      }
      const expiresAt = new Date(
        now.getTime() + GENERATION_RETENTION_DAYS * 86_400_000,
      )
      await tx.recommendationCowatchGeneration.create({
        data: {
          id: graph.generation,
          projectionVersion: COWATCH_PROJECTION_VERSION,
          featureVersion: COWATCH_FEATURE_VERSION,
          sourceCount: graph.qualifiedOutcomes,
          contributionCount: graph.contributions.length,
          edgeCount: graph.edges.length,
          distinctViewerCount: graph.uniqueViewers,
          windowEnd: now,
          terminalDecision: "no_promotion",
          decisionReason,
          publishedAt: now,
          expiresAt,
        },
      })
      for (let offset = 0; offset < graph.sources.length; offset += 500) {
        await tx.recommendationCowatchSourceContribution.createMany({
          data: graph.sources.slice(offset, offset + 500).map((row) => ({
            id: randomUUID(),
            generationId: graph.generation,
            outcomeId: row.outcomeId,
            eligibilityDecisionId: row.eligibilityDecisionId!,
            eligibilityRevision: row.eligibilityRevision!,
            eligibilityPolicyVersion: row.eligibilityPolicyVersion!,
            viewerProfileId: profileByOutcome.get(row.outcomeId) ?? null,
            mediaId: row.mediaId,
            sessionDigest: row.sessionDigest,
            viewerKeyDigest: createHash("sha256")
              .update(row.viewerKey)
              .digest("hex"),
            qualityWeight: row.qualityWeight,
            occurredAt: row.occurredAt,
            expiresAt: row.expiresAt < expiresAt ? row.expiresAt : expiresAt,
          })),
        })
      }
      for (let offset = 0; offset < graph.contributions.length; offset += 500) {
        await tx.recommendationCowatchContribution.createMany({
          data: graph.contributions.slice(offset, offset + 500).map((row) => ({
            id: randomUUID(),
            generationId: graph.generation,
            sourceOutcomeId: row.sourceOutcomeId,
            targetOutcomeId: row.targetOutcomeId,
            viewerProfileId: profileByOutcome.get(row.sourceOutcomeId) ?? null,
            sourceMediaId: row.sourceMediaId,
            targetMediaId: row.targetMediaId,
            sessionDigest: row.sessionDigest,
            viewerKeyDigest: createHash("sha256")
              .update(row.viewerKey)
              .digest("hex"),
            gapMs: row.gapMs,
            qualityWeight: row.qualityWeight,
            recencyWeight: row.recencyWeight,
            effectiveWeight: row.effectiveWeight,
            expiresAt,
          })),
        })
      }
      for (let offset = 0; offset < graph.edges.length; offset += 500) {
        await tx.recommendationCowatchEdge.createMany({
          data: graph.edges.slice(offset, offset + 500).map((edge) => ({
            id: randomUUID(),
            generationId: graph.generation,
            sourceMediaId: edge.sourceMediaId,
            targetMediaId: edge.targetMediaId,
            sessionSupport: edge.sessionSupport,
            distinctViewerSupport: edge.distinctViewerSupport,
            confidence: edge.confidence,
            popularityCorrectedLift: edge.popularityCorrectedLift,
            recencyWeight: edge.recencyWeight,
            qualityWeight: edge.qualityWeight,
            effectiveWeight: edge.effectiveWeight,
            contamination: edge.contamination,
            eligible: edge.eligible,
          })),
        })
      }
      return {
        status: "published",
        generation: graph.generation,
        sourceCount: graph.qualifiedOutcomes,
        contributionCount: graph.contributions.length,
        edgeCount: graph.edges.length,
        terminalDecision: "no_promotion",
        decisionReason,
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30_000,
    },
  )
}
