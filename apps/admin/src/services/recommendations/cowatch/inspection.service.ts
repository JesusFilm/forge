import { Prisma, type PrismaClient } from "@prisma/client"
import { cowatchSourceInvalidSql } from "./lineage"
import { profileLineageEligibleSql } from "../profiles/profile-lineage"
import {
  RECOMMENDATION_OPS_DAY_MS,
  RECOMMENDATION_TRACE_ACCESS_REASON,
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
  boundedRecommendationActorDigest,
  boundedRecommendationIdentifier,
} from "../admin-ops/shared"
import {
  compatibleCowatchFeature,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
  COWATCH_SHADOW_GENERATOR_KEY,
  type CowatchFeature,
} from "./graph"
import { COWATCH_LEGACY_SOURCE_WINDOW_VERSION } from "./source-window"

export type CowatchAnchor = Readonly<{
  mediaId: string
  kind: "session" | "durable" | "seed"
  interestOrdinal: number | null
  weight: number
}>

/** Profile interests select anchors; edge support never depends on the profile. */
export function chooseCowatchAnchors(input: {
  seedMediaId?: string | null
  interests: readonly CowatchAnchor[]
}): CowatchAnchor[] {
  const ordered = [
    ...input.interests
      .filter((interest) => interest.kind !== "seed")
      .sort(
        (a, b) =>
          (a.kind === "session" ? 0 : 1) - (b.kind === "session" ? 0 : 1) ||
          b.weight - a.weight ||
          a.mediaId.localeCompare(b.mediaId),
      ),
    ...(input.seedMediaId
      ? [
          {
            mediaId: input.seedMediaId,
            kind: "seed" as const,
            interestOrdinal: null,
            weight: 1,
          },
        ]
      : []),
  ]
  const distinct = ordered.filter(
    (anchor, index) =>
      ordered.findIndex((candidate) => candidate.mediaId === anchor.mediaId) ===
      index,
  )
  const selected = distinct.slice(0, 5)
  const seed = distinct.find((anchor) => anchor.mediaId === input.seedMediaId)
  return seed && !selected.some((anchor) => anchor.mediaId === seed.mediaId)
    ? [...selected.slice(0, 4), seed]
    : selected
}

export type CowatchInspection = Readonly<{
  shadowEvaluation: Readonly<{
    id: string
    state: string
    decision: string | null
    reasonCode: string | null
    processedCount: number
    sampledCount: number
    coverage: number | null
    overlap: number | null
    latencyP95Ms: number | null
  }> | null
  generation: string | null
  publishedAt: Date | null
  sourceWindow: Readonly<{
    version: string
    windowStart: Date
    windowEnd: Date
    evaluationAsOf: Date
  }> | null
  rawSourceCount: number | null
  attemptedPairCount: number | null
  sourceCount: number
  contributionCount: number
  edgeCount: number
  distinctViewerCount: number
  state: "unavailable" | "current" | "stale"
  staleReasons: readonly string[]
  terminalDecision: "no_promotion"
  decisionReason: string
  anchors: readonly CowatchAnchor[]
  selectedEdges: readonly CowatchFeature[]
  reverseEdges: readonly CowatchFeature[]
  candidates: readonly CowatchFeature[]
  overlapMediaIds: readonly string[]
  candidateDecision: "live_baseline_fallback" | "shadow_candidates_available"
}>

/** Current pointer, privacy generation and exact lineage are mandatory. */
export async function loadValidatedCowatchProfileInterests(
  prisma: Pick<PrismaClient, "$queryRaw">,
  profileGenerationId: string | null | undefined,
  now: Date,
): Promise<
  Array<{
    mediaId: string
    kind: "session" | "durable"
    interestOrdinal: number
    weight: number
  }>
> {
  return profileGenerationId
    ? await prisma.$queryRaw<
        Array<{
          mediaId: string
          kind: "session" | "durable"
          interestOrdinal: number
          weight: number
        }>
      >(Prisma.sql`
        SELECT interest.medoid_media_id AS "mediaId",
          interest.kind::text AS kind,
          interest.interest_ordinal AS "interestOrdinal",
          interest.weight
        FROM recommendation_profile_projection_generation generation
        JOIN recommendation_profile_projection_pointer pointer
          ON pointer.generation_id = generation.id
          AND pointer.scope = generation.scope
        LEFT JOIN recommendation_profile profile
          ON profile.id = generation.profile_id
        JOIN recommendation_profile_interest interest
          ON interest.generation_id = generation.id
          AND interest.expires_at > ${now}
        WHERE generation.id = ${profileGenerationId}
          AND generation.state = 'published'
          AND generation.expires_at > ${now}
          AND (
            (generation.scope = 'durable'
              AND profile.state = 'active'
              AND profile.expires_at > ${now}
              AND profile.privacy_generation = generation.privacy_generation
              AND pointer.profile_id = profile.id
              AND pointer.privacy_generation = profile.privacy_generation)
            OR (generation.scope = 'session'
              AND pointer.session_digest = generation.session_digest)
          )
          AND ${profileLineageEligibleSql(Prisma.sql`generation.id`, now)}
        ORDER BY CASE interest.kind WHEN 'session' THEN 0 ELSE 1 END,
          interest.weight DESC, interest.interest_ordinal
        LIMIT 5
      `)
    : []
}

export async function loadCowatchInspection(
  prisma: PrismaClient,
  input: {
    now: Date
    sourceMediaId?: string | null
    requestId?: string | null
    actorDigest?: string | null
    additionalAnchors?: readonly CowatchAnchor[]
    /** Exact identity never falls back to the newest generation. */
    generationId?: string
  },
): Promise<CowatchInspection> {
  const [generation, evaluation] = await Promise.all([
    input.generationId !== undefined
      ? prisma.recommendationCowatchGeneration.findUnique({
          where: { id: input.generationId },
        })
      : prisma.recommendationCowatchGeneration.findFirst({
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        }),
    prisma.recommendationShadowEvaluation.findFirst({
      where: { generatorVersion: COWATCH_SHADOW_GENERATOR_KEY },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        state: true,
        processedCount: true,
        sampledCount: true,
        coverage: true,
        overlap: true,
        latencyP95Ms: true,
        decision: { select: { decision: true, reasonCode: true } },
      },
    }),
  ])
  const shadowEvaluation = evaluation
    ? {
        id: evaluation.id,
        state: evaluation.state,
        decision: evaluation.decision?.decision ?? null,
        reasonCode: evaluation.decision?.reasonCode ?? null,
        processedCount: evaluation.processedCount,
        sampledCount: evaluation.sampledCount,
        coverage: evaluation.coverage,
        overlap: evaluation.overlap,
        latencyP95Ms: evaluation.latencyP95Ms,
      }
    : null
  const empty: CowatchInspection = {
    shadowEvaluation,
    generation: null,
    publishedAt: null,
    sourceWindow: null,
    rawSourceCount: null,
    attemptedPairCount: null,
    sourceCount: 0,
    contributionCount: 0,
    edgeCount: 0,
    distinctViewerCount: 0,
    state: "unavailable",
    staleReasons: ["generation_unavailable"],
    terminalDecision: "no_promotion",
    decisionReason: "generation_unavailable",
    anchors: [],
    selectedEdges: [],
    reverseEdges: [],
    candidates: [],
    overlapMediaIds: [],
    candidateDecision: "live_baseline_fallback",
  }
  if (!generation) return empty
  const request =
    input.requestId &&
    input.actorDigest &&
    boundedRecommendationIdentifier.test(input.requestId) &&
    boundedRecommendationActorDigest.test(input.actorDigest)
      ? await prisma.$transaction(async (tx) => {
          const root = await tx.recommendationRequest.findFirst({
            where: { id: input.requestId!, expiresAt: { gt: input.now } },
            select: { id: true },
          })
          if (!root) return null
          const [decision, items] = await Promise.all([
            tx.recommendationPersonalizationDecision.findUnique({
              where: { requestId: root.id },
              select: { projectionGenerationId: true },
            }),
            tx.recommendationServedItem.findMany({
              where: { requestId: root.id, expiresAt: { gt: input.now } },
              select: { targetMediaId: true },
              take: 6,
            }),
          ])
          await tx.recommendationTraceAccessAudit.create({
            data: {
              requestId: root.id,
              actorDigest: input.actorDigest!,
              reasonCode: RECOMMENDATION_TRACE_ACCESS_REASON,
              accessedAt: input.now,
              expiresAt: new Date(
                input.now.getTime() +
                  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS *
                    RECOMMENDATION_OPS_DAY_MS,
              ),
            },
          })
          return {
            projectionGenerationId: decision?.projectionGenerationId ?? null,
            items,
          }
        })
      : null
  const profileGenerationId = request?.projectionGenerationId
  const profileInterests = await loadValidatedCowatchProfileInterests(
    prisma,
    profileGenerationId,
    input.now,
  )
  const anchors = chooseCowatchAnchors({
    seedMediaId: input.sourceMediaId,
    interests: [
      ...profileInterests.map((interest) => ({
        mediaId: interest.mediaId,
        kind: interest.kind,
        interestOrdinal: interest.interestOrdinal,
        weight: interest.weight,
      })),
      ...(input.additionalAnchors ?? []),
    ],
  })
  const anchorIds = anchors.map((anchor) => anchor.mediaId)
  const [
    sourceCount,
    contributionCount,
    invalidSources,
    invalid,
    selectedRows,
    reverseRows,
  ] = await Promise.all([
    prisma.recommendationCowatchSourceContribution.count({
      where: { generationId: generation.id },
    }),
    prisma.recommendationCowatchContribution.count({
      where: { generationId: generation.id },
    }),
    prisma.$queryRaw<Array<{ invalid: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS invalid
        FROM recommendation_cowatch_source_contribution source_row
        JOIN recommendation_outcome_revision outcome ON outcome.id = source_row.outcome_id
        JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
        LEFT JOIN recommendation_profile profile ON profile.id = source_row.viewer_profile_id
        LEFT JOIN recommendation_eligibility_decision decision
          ON decision.id = source_row.eligibility_decision_id
        LEFT JOIN recommendation_cowatch_suppression suppression ON suppression.episode_id = episode.id
        WHERE source_row.generation_id = ${generation.id}
          AND ${cowatchSourceInvalidSql(input.now, generation.lineageVersion)}
      `),
    prisma.$queryRaw<Array<{ invalid: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS invalid
        FROM recommendation_cowatch_contribution contribution
        JOIN recommendation_outcome_revision source
          ON source.id = contribution.source_outcome_id
        JOIN recommendation_outcome_revision target
          ON target.id = contribution.target_outcome_id
        LEFT JOIN recommendation_cowatch_suppression suppressed_source
          ON suppressed_source.episode_id = source.episode_id
        LEFT JOIN recommendation_cowatch_suppression suppressed_target
          ON suppressed_target.episode_id = target.episode_id
        WHERE contribution.generation_id = ${generation.id}
          AND (
            contribution.expires_at <= ${input.now}
            OR source.expires_at <= ${input.now}
            OR target.expires_at <= ${input.now}
            OR suppressed_source.episode_id IS NOT NULL
            OR suppressed_target.episode_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM recommendation_outcome_revision newer
              WHERE newer.supersedes_id IN (source.id, target.id))
            OR NOT EXISTS (
              SELECT 1 FROM recommendation_eligibility_decision decision
              WHERE decision.outcome_id = source.id
                AND decision.is_current = true
                AND decision.state = 'eligible'
                AND 'aggregate' = ANY(decision.eligible_scopes)
                AND decision.expires_at > ${input.now}
            )
            OR NOT EXISTS (
              SELECT 1 FROM recommendation_eligibility_decision decision
              WHERE decision.outcome_id = target.id
                AND decision.is_current = true
                AND decision.state = 'eligible'
                AND 'aggregate' = ANY(decision.eligible_scopes)
                AND decision.expires_at > ${input.now}
            )
          )
      `),
    anchorIds.length > 0
      ? prisma.recommendationCowatchEdge.findMany({
          where: {
            generationId: generation.id,
            sourceMediaId: { in: anchorIds },
          },
          orderBy: [
            { eligible: "desc" },
            { confidence: "desc" },
            { popularityCorrectedLift: "desc" },
            { targetMediaId: "asc" },
          ],
          take: 32,
        })
      : Promise.resolve([]),
    input.sourceMediaId
      ? prisma.recommendationCowatchEdge.findMany({
          where: {
            generationId: generation.id,
            targetMediaId: input.sourceMediaId,
          },
          orderBy: [{ confidence: "desc" }, { sourceMediaId: "asc" }],
          take: 12,
        })
      : Promise.resolve([]),
  ])
  const staleReasons = [
    ...(generation.invalidatedAt ? ["source_lineage_invalidated"] : []),
    ...(generation.projectionVersion !== COWATCH_PROJECTION_VERSION ||
    generation.featureVersion !== COWATCH_FEATURE_VERSION
      ? ["contract_incompatible"]
      : []),
    ...(generation.expiresAt <= input.now ? ["generation_expired"] : []),
    ...(input.now.getTime() - generation.publishedAt.getTime() > 86_400_000
      ? ["generation_stale"]
      : []),
    ...(generation.sourceCount !== sourceCount ? ["source_count_changed"] : []),
    ...(generation.contributionCount !== contributionCount
      ? ["contribution_count_changed"]
      : []),
    ...(Number(invalidSources[0]?.invalid ?? 0) > 0 ||
    Number(invalid[0]?.invalid ?? 0) > 0
      ? ["source_lineage_invalid"]
      : []),
  ]
  const state = staleReasons.length === 0 ? "current" : "stale"
  const toFeature = (row: (typeof selectedRows)[number]): CowatchFeature => ({
    contractVersion: COWATCH_FEATURE_VERSION,
    generation: row.generationId,
    sourceMediaId: row.sourceMediaId,
    targetMediaId: row.targetMediaId,
    sessionSupport: row.sessionSupport,
    distinctViewerSupport: row.distinctViewerSupport,
    confidence: row.confidence,
    popularityCorrectedLift: row.popularityCorrectedLift,
    recencyWeight: row.recencyWeight,
    qualityWeight: row.qualityWeight,
    effectiveWeight: row.effectiveWeight,
    contamination: row.contamination,
    eligible: row.eligible,
  })
  const selectedEdges = selectedRows.map(toFeature)
  const candidates =
    state === "current"
      ? selectedEdges
          .filter((edge) => compatibleCowatchFeature(edge, generation.id))
          .filter((edge) => !anchorIds.includes(edge.targetMediaId))
          .slice(0, 12)
      : []
  const liveIds = new Set(
    (request?.items ?? []).map((item) => item.targetMediaId),
  )
  return {
    shadowEvaluation,
    generation: generation.id,
    publishedAt: generation.publishedAt,
    sourceWindow: {
      version:
        generation.sourceWindowVersion ?? COWATCH_LEGACY_SOURCE_WINDOW_VERSION,
      // Historical rows used both an outcome-write and an event-age window.
      // Name that contract explicitly; do not relabel it as a finite event scope.
      windowStart:
        generation.windowStart ??
        new Date(generation.windowEnd.getTime() - 180 * 86_400_000),
      windowEnd: generation.windowEnd,
      evaluationAsOf: generation.evaluationAsOf ?? generation.windowEnd,
    },
    rawSourceCount: generation.rawSourceCount,
    attemptedPairCount: generation.attemptedPairCount,
    sourceCount: generation.sourceCount,
    contributionCount: generation.contributionCount,
    edgeCount: generation.edgeCount,
    distinctViewerCount: generation.distinctViewerCount,
    state,
    staleReasons,
    terminalDecision: "no_promotion",
    decisionReason: generation.decisionReason,
    anchors,
    selectedEdges,
    reverseEdges: reverseRows.map(toFeature),
    candidates,
    overlapMediaIds: candidates
      .filter((edge) => liveIds.has(edge.targetMediaId))
      .map((edge) => edge.targetMediaId),
    candidateDecision:
      candidates.length === 0
        ? "live_baseline_fallback"
        : "shadow_candidates_available",
  }
}
