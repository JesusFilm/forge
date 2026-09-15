import {
  RecommendationAuditKind,
  RecommendationDeliveryResult,
  RecommendationEpisodeState,
  RecommendationRequestState,
  type PrismaClient,
} from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  RECOMMENDATION_TRACE_ACCESS_REASON,
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
  RECOMMENDATION_TRACE_PAGE_SIZE,
  loadRecommendationRequestDetail,
  loadRecommendationTracePage,
  recommendationTraceActorDigest,
} from "@/services/recommendations/admin-ops"

const NOW = new Date("2026-08-19T12:00:00.000Z")
const DAY_MS = 86_400_000
const ACTOR_DIGEST = recommendationTraceActorDigest(
  "admin-1",
  "test-admin-session-secret-at-least-32-chars",
)

function prismaFixture() {
  return {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    recommendationRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    recommendationRetentionRun: { findFirst: vi.fn() },
    recommendationContentAction: { findFirst: vi.fn() },
    recommendationEligibilityDecision: { findFirst: vi.fn() },
    recommendationControlEvaluation: { findFirst: vi.fn() },
    recommendationExperimentEvaluation: { findFirst: vi.fn() },
    recommendationExperimentEvaluationRun: { findFirst: vi.fn() },
    recommendationExperimentAssignment: { findFirst: vi.fn() },
    recommendationExperiment: { findFirst: vi.fn() },
    recommendationProfileProjectionRun: { findFirst: vi.fn() },
    recommendationProfileProjectionContribution: { findFirst: vi.fn() },
    recommendationProfileInterest: { findFirst: vi.fn() },
    recommendationProfileProjectionGeneration: { findFirst: vi.fn() },
    recommendationShadowEvaluation: { findFirst: vi.fn() },
    recommendationServingControl: { findUnique: vi.fn() },
    recommendationPromotionPointer: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    recommendationPromotionApproval: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    recommendationPromotionRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    recommendationPromotionEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    recommendationProfile: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({
        _sum: { staleWorkerRejections: 0 },
        _max: { deletionDrillAt: null },
      }),
    },
    recommendationConsentTransition: {
      groupBy: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    recommendationTraceAccessAudit: { create: vi.fn() },
  }
}

describe("recommendation admin traces", () => {
  it("uses a 50-row active-root keyset page and bounded filters", async () => {
    const prisma = prismaFixture()
    const rows = Array.from(
      { length: RECOMMENDATION_TRACE_PAGE_SIZE + 1 },
      (_, index) => ({
        id: `request-${String(index).padStart(2, "0")}`,
        state: RecommendationRequestState.ISSUED,
        result: RecommendationDeliveryResult.SERVED,
        fallbackReason: null,
        strategyVersion: "semantic-transcript-pgvector-v1",
        classifierVersion: "legacy-position-v0",
        locale: "en",
        expectedItemCount: 6,
        retrievalLatencyMs: 100 + index,
        responseBytes: 1_024,
        createdAt: new Date(NOW.getTime() - index * 1_000),
        issuedAt: new Date(NOW.getTime() - index * 1_000 + 10),
        _count: {
          items: 6,
          renderedFacts: 4,
          impressions: 3,
          selections: 1,
          episodes: 1,
          outcomes: 0,
          conflicts: 0,
        },
      }),
    )
    prisma.recommendationRequest.findMany.mockResolvedValue(rows)

    const data = await loadRecommendationTracePage(
      prisma as unknown as PrismaClient,
      {
        window: "7d",
        requestState: "issued",
        fallbackReason: "semantic_timeout",
        evidenceState: "late",
        now: NOW,
      },
    )

    const query = prisma.recommendationRequest.findMany.mock.calls[0]?.[0]
    expect(query).toMatchObject({
      take: RECOMMENDATION_TRACE_PAGE_SIZE + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    })
    expect(query.where).toMatchObject({
      expiresAt: { gt: NOW },
      state: RecommendationRequestState.ISSUED,
      fallbackReason: "semantic_timeout",
      playbackFacts: { some: { late: true } },
    })
    expect(JSON.stringify(query.select)).not.toMatch(
      /sessionDigest|deliveryJti|signingKid|capability|payloadDigest|claimNonce/i,
    )
    expect(data).toMatchObject({
      window: { preset: "7d" },
      filters: {
        requestState: "issued",
        fallbackReason: "semantic_timeout",
        evidenceState: "late",
      },
    })
    expect(data.rows).toHaveLength(RECOMMENDATION_TRACE_PAGE_SIZE)
    expect(data.nextCursor).toEqual(expect.any(String))

    prisma.recommendationRequest.findMany.mockResolvedValueOnce([])
    await loadRecommendationTracePage(prisma as unknown as PrismaClient, {
      window: "7d",
      cursor: data.nextCursor as string,
      now: NOW,
    })
    const boundaryRow = rows[RECOMMENDATION_TRACE_PAGE_SIZE - 1]
    const secondQuery = prisma.recommendationRequest.findMany.mock.calls[1]?.[0]
    expect(secondQuery.where.AND).toEqual([
      {
        OR: [
          { createdAt: { lt: boundaryRow.createdAt } },
          {
            createdAt: boundaryRow.createdAt,
            id: { lt: boundaryRow.id },
          },
        ],
      },
    ])
  })

  it("filters classifier lag immediately for terminal facts without outcomes", async () => {
    const prisma = prismaFixture()
    prisma.recommendationRequest.findMany.mockResolvedValueOnce([])

    await loadRecommendationTracePage(prisma as unknown as PrismaClient, {
      evidenceState: "classifier_lag",
      now: NOW,
    })

    const query = prisma.recommendationRequest.findMany.mock.calls[0]?.[0]
    expect(query.where.episodes).toEqual({
      some: {
        outcomes: { none: {} },
        OR: [
          {
            facts: {
              some: { kind: { in: ["playback_end", "playback_error"] } },
            },
          },
          {
            state: {
              in: [
                RecommendationEpisodeState.PENDING,
                RecommendationEpisodeState.CLAIMED,
              ],
            },
            activeUntil: { lte: NOW },
          },
        ],
      },
    })
  })

  it("projects detail safely, orders facts by sequence, and audits for 90 days", async () => {
    const prisma = prismaFixture()
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "request-1",
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "legacy-position-v0",
          seedMediaId: "seed-media",
          locale: "en",
          expectedItemCount: 1,
          state: RecommendationRequestState.ISSUED,
          result: RecommendationDeliveryResult.SERVED,
          fallbackReason: null,
          retrievalLatencyMs: 110,
          responseBytes: 2_048,
          createdAt: new Date("2026-08-19T10:00:00.000Z"),
          issuedAt: new Date("2026-08-19T10:00:00.010Z"),
          manifestId: "semantic-transcript-pgvector-v1",
          manifestStrategyVersion: "semantic-transcript-pgvector-v1",
          manifestContractVersion: "semantic-recommendation-v1",
          manifestSurfaceVersion: "watch-below-player-v1",
          manifestGenerator: "semantic",
          manifestMaxItems: 6,
          experimentBypassReason: null,
          assignmentId: "assignment-1",
          assignmentExperimentId: "semantic-aa-v1",
          experimentVersion: "semantic-aa-v1",
          assignmentArm: "challenger",
          assignmentProbability: 0.5,
          assignmentConfigurationDigest: "b".repeat(64),
          assignmentGeneration: 1,
          effectiveManifestId: "semantic-experiment-aa-v1",
          actualExposureCount: 1n,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "candidate-run-1",
          purpose: "watch",
          contextVersion: "recommendation-context-v1",
          generatorVersion: "semantic-transcript-candidate-v1",
          unionVersion: "canonical-video-union-v1",
          eligibilityVersion: "watch-playable-locale-v1",
          rankerVersion: "semantic-deterministic-ranker-v1",
          composerVersion: "minimal-playable-slate-v1",
          candidateEligibilityParity: "passed",
          rankerParity: "passed",
          nominatedCount: 2,
          canonicalizedCount: 2,
          deduplicatedCount: 1,
          rejectedCount: 0,
          scoredCount: 1,
          orderedCount: 1,
          requestedCount: 6,
          composedCount: 1,
          shortfallReason: "eligibility_exhausted",
          evidenceComplete: true,
          fallbackReason: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          lane: "profile_challenger",
          executionMode: "hybrid_personalized",
          effectiveManifestId: "semantic-profile-hybrid-v1",
          reasonCode: null,
          projectionScope: "durable",
          projectionVersion: "multi-interest-profile-projection-v1",
          projectionGeneration: 3,
          interestCount: 2,
          sessionIntentPresent: true,
          retrievalLatencyMs: 37,
          feedbackSourceRequestIds: ["prior-qualified-request"],
        },
      ])
      .mockResolvedValueOnce([
        {
          stage: "nominated",
          ordinal: 0,
          candidateKey: "semantic:target-media:3",
          targetMediaId: "target-media",
          sourceGenerator: "semantic",
          sourceRank: 1,
          sourceScore: 0.91,
          sourceCount: 1,
          sourceSummaries: ["semantic · rank 1 · score 0.91"],
          contributors: [
            {
              generator: "semantic",
              generatorVersion: "semantic-transcript-candidate-v1",
              rank: 1,
            },
          ],
          normalizedScore: null,
          rrfScore: null,
          deterministicScore: null,
          finalPosition: null,
          reasonCodes: [],
        },
        {
          stage: "composed",
          ordinal: 0,
          candidateKey: "target-media",
          targetMediaId: "target-media",
          sourceGenerator: null,
          sourceRank: null,
          sourceScore: null,
          sourceCount: 2,
          sourceSummaries: [
            "semantic · rank 1 · score 0.91",
            "multi-interest-profile · rank 1 · score 0.85",
          ],
          contributors: [
            {
              generator: "semantic",
              generatorVersion: "semantic-transcript-candidate-v1",
              rank: 1,
            },
            {
              generator: "multi-interest-profile",
              generatorVersion: "multi-interest-profile-candidate-v1",
              rank: 1,
            },
          ],
          normalizedScore: null,
          rrfScore: null,
          deterministicScore: 1,
          finalPosition: 0,
          reasonCodes: [
            "playable_localized_deduplicated",
            "refill_after_suppression",
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          evaluationId: "shadow-evaluation-1",
          runId: "shadow-run-1",
          generatorVersion: "profile-interest-candidate-v1",
          evaluationState: "terminal",
          runState: "published",
          sampleOrdinal: 0,
          samplingVersion: "stable-request-hash-v1",
          contextVersion: "recommendation-context-v1",
          eligibilityVersion: "watch-playable-locale-v1",
          retentionPolicyVersion: "request-root-29d-aggregate-365d-v1",
          usedProfileProjection: true,
          privacyGeneration: 4,
          liveSlateUnchanged: true,
          nominatedCount: 2,
          eligibleCount: 1,
          rejectedCount: 1,
          coverage: 1,
          overlap: 0.5,
          novelty: 0.5,
          diversity: 0.75,
          rejection: 0.5,
          latencyMs: 241,
          cohortQuality: 0.82,
          inputFreshnessMs: 1_000,
          inputCapturedAt: new Date("2026-08-19T10:00:00.000Z"),
          finishedAt: new Date("2026-08-19T10:01:00.000Z"),
          decision: "promote_to_experiment",
          decisionReasonCode: "shadow_evidence_meets_policy",
          reevaluationCondition:
            "reopen_if_manifest_or_eligibility_version_changes",
          decidedAt: new Date("2026-08-19T11:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          runId: "shadow-run-1",
          ordinal: 0,
          candidateKey: "target-media",
          targetMediaId: "target-media",
          generator: "profile-interest",
          generatorVersion: "profile-interest-candidate-v1",
          sourceRank: 1,
          sourceScore: 0.88,
          eligible: true,
          reasonCodes: [],
          shadowPosition: 0,
          overlapsLive: true,
          provenanceKeys: ["interestOrdinal"],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "item-1",
          position: 0,
          targetMediaId: "target-media",
          canonicalHref: "/watch/target.html/english.html",
          candidateGenerator: "semantic",
          sceneIndex: 3,
          similarity: 0.91,
          videoTitle: "Target video",
          audioLanguageSlug: "english",
          startSeconds: 0,
          endSeconds: 45,
          renderedId: "render-1",
          renderedOccurredAt: new Date("2026-08-19T10:00:04.000Z"),
          renderedReceivedAt: new Date("2026-08-19T10:00:02.000Z"),
          impressionId: null,
          impressionVisibilityPolicy: null,
          impressionOccurredAt: null,
          impressionReceivedAt: null,
          selectionId: "selection-1",
          selectionOccurredAt: new Date("2026-08-19T10:00:03.000Z"),
          selectionReceivedAt: new Date("2026-08-19T10:00:03.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "episode-1",
          itemId: "item-1",
          state: RecommendationEpisodeState.FINALIZED,
          mediaId: "target-media",
          createdAt: new Date("2026-08-19T10:00:03.000Z"),
          claimedAt: new Date("2026-08-19T10:00:04.000Z"),
          finalizedAt: new Date("2026-08-19T10:00:30.000Z"),
          activeUntil: new Date("2026-08-19T14:00:03.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "fact-2",
          episodeId: "episode-1",
          sequence: 2,
          kind: "playback_end",
          occurredAt: new Date("2026-08-19T10:00:20.000Z"),
          receivedAt: new Date("2026-08-19T10:00:21.000Z"),
          late: false,
          initiation: null,
          positionSeconds: 45,
          fromSeconds: null,
          toSeconds: null,
          durationSeconds: 120,
          progress: 0.375,
          wallElapsedMilliseconds: 45_000,
          activeMilliseconds: null,
          coverage: null,
          missingReason: null,
          completed: false,
          reason: "route_exit",
          code: null,
        },
        {
          id: "fact-1",
          episodeId: "episode-1",
          sequence: 1,
          kind: "playback_start",
          occurredAt: new Date("2026-08-19T10:00:25.000Z"),
          receivedAt: new Date("2026-08-19T10:00:05.000Z"),
          late: false,
          initiation: "manual",
          positionSeconds: 0,
          fromSeconds: null,
          toSeconds: null,
          durationSeconds: null,
          progress: null,
          wallElapsedMilliseconds: null,
          activeMilliseconds: null,
          coverage: null,
          missingReason: null,
          completed: null,
          reason: null,
          code: null,
        },
        {
          id: "fact-3",
          episodeId: "episode-1",
          sequence: 3,
          kind: "playback_active_visible_playing",
          occurredAt: new Date("2026-08-19T10:00:28.000Z"),
          receivedAt: new Date("2026-08-19T10:00:29.000Z"),
          late: false,
          initiation: null,
          positionSeconds: null,
          fromSeconds: null,
          toSeconds: null,
          durationSeconds: null,
          progress: null,
          wallElapsedMilliseconds: null,
          activeMilliseconds: 1_000,
          coverage: "partial",
          missingReason: "visibility_unavailable",
          completed: null,
          reason: null,
          code: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "outcome-1",
          episodeId: "episode-1",
          classifierVersion: "legacy-position-v0",
          factWatermark: 3,
          revision: 1,
          supersedesRevision: null,
          qualifiedView: true,
          viewQualityWeight: null,
          viewQualityWeightReason: "continuous_weight_not_available",
          activePlaybackMilliseconds: null,
          durationSeconds: null,
          durationCohort: null,
          activeCoverage: null,
          reasons: ["elapsed_at_least_30_seconds"],
          learningEligible: false,
          eligibilityState: "pending",
          eligibilityPolicyVersion: null,
          eligibilityRevision: null,
          eligibilityReasonCodes: [],
          eligibleScopes: [],
          contributionWeight: null,
          createdAt: new Date("2026-08-19T10:00:30.000Z"),
        },
        {
          id: "outcome-2",
          episodeId: "episode-1",
          classifierVersion: "active-watch-proxy-v1",
          factWatermark: 3,
          revision: 1,
          supersedesRevision: null,
          qualifiedView: false,
          viewQualityWeight: 1 / 120,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 1_000,
          durationSeconds: 120,
          durationCohort: "medium",
          activeCoverage: "partial",
          reasons: ["active_visible_playing_coverage_partial"],
          learningEligible: true,
          eligibilityState: "eligible",
          eligibilityPolicyVersion: "recommendation-integrity-v1",
          eligibilityRevision: 1,
          eligibilityReasonCodes: ["aggregate_distinct_support_pending"],
          eligibleScopes: ["profile"],
          contributionWeight: 1 / 120,
          createdAt: new Date("2026-08-19T10:00:30.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "action-1",
          itemId: "item-1",
          episodeId: "episode-1",
          actionClass: "human_action",
          actionKind: "share",
          actorClass: "human_anonymous",
          purpose: "watch",
          actionDetail: "link_copy",
          targetMediaId: "target-media",
          candidateGenerator: "semantic",
          destinationState: "none",
          occurredAt: new Date("2026-08-19T10:00:29.000Z"),
          receivedAt: new Date("2026-08-19T10:00:31.000Z"),
          late: false,
          learningEligible: false,
          eligibilityState: "pending",
          eligibilityPolicyVersion: null,
          eligibilityRevision: null,
          eligibilityReasonCodes: [],
          eligibleScopes: [],
          contributionWeight: null,
          replayCount: 1,
          conflictCount: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "audit-1",
          kind: RecommendationAuditKind.REPLAY,
          reasonCode: "duplicate",
          count: 1,
          occurredAt: new Date("2026-08-19T10:00:07.000Z"),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          revision: 3,
          state: "ready",
          policyVersion: "semantic-control-readiness-v1",
          windowStart: new Date("2026-08-12T06:00:00.000Z"),
          windowEnd: new Date("2026-08-19T06:00:00.000Z"),
          evaluatedAt: new Date("2026-08-19T10:00:00.000Z"),
          explanation:
            "Semantic-only is ready to serve as a measurable control; no incremental viewer-value claim is made.",
        },
      ])
    const tx = {
      $queryRaw: queryRaw,
      recommendationTraceAccessAudit: { create: vi.fn() },
      recommendationExperimentEvaluation: {
        findFirst: vi.fn().mockResolvedValue({
          revision: 2,
          state: "PASS",
          inputDigest: "c".repeat(64),
          evaluatedAt: new Date("2026-08-19T11:00:00.000Z"),
        }),
      },
    }
    prisma.$transaction.mockImplementation(async (callback) => callback(tx))

    const data = await loadRecommendationRequestDetail(
      prisma as unknown as PrismaClient,
      { requestId: "request-1", actorDigest: ACTOR_DIGEST, now: NOW },
    )

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    })

    const projectionSql = queryRaw.mock.calls
      .map(([query]) => String(query.sql ?? query.text ?? query.strings))
      .join("\n")
    const projectionParameters = queryRaw.mock.calls.flatMap(
      ([query]) => query.values ?? [],
    )
    expect(projectionSql).toContain("candidate_provenance ->> 'sceneIndex'")
    expect(projectionSql).toContain("payload ->>")
    expect(projectionParameters).toEqual(
      expect.arrayContaining(["activeMilliseconds", "wallElapsedMilliseconds"]),
    )
    expect(projectionSql).toContain("payload ->> 'coverage'")
    expect(projectionSql).toContain("payload ->> 'missingReason'")
    expect(projectionSql).toContain("payload ->> 'reason'")
    expect(projectionSql).toContain("recommendation_content_action")
    expect(projectionSql).toContain("recommendation_eligibility_decision")
    expect(projectionSql).toContain("recommendation_control_evaluation")
    expect(projectionSql).toContain("recommendation_candidate_run")
    expect(projectionSql).toContain("recommendation_candidate_stage_evidence")
    expect(projectionSql).toContain("recommendation_shadow_run")
    expect(projectionSql).toContain("recommendation_shadow_nomination")
    expect(projectionSql).toContain("recommendation_personalization_decision")
    expect(projectionSql).toContain("jsonb_array_length(stage.source_evidence)")
    expect(projectionSql).toContain(
      "jsonb_array_elements(stage.source_evidence)",
    )
    expect(projectionSql).toContain("evaluation.window_start <=")
    expect(projectionSql).not.toMatch(
      /activeForegroundSeconds|elapsedSeconds|endReason|startupDelayMs/,
    )
    expect(projectionSql).not.toMatch(
      /candidate_provenance\s+AS|presentation\s+AS|payload\s+AS|session_digest|delivery_jti|signing_kid|capability_jti|payload_digest|claim_nonce_digest|tab_digest|input_digest/i,
    )
    expect(tx.recommendationTraceAccessAudit.create).toHaveBeenCalledWith({
      data: {
        requestId: "request-1",
        actorDigest: ACTOR_DIGEST,
        reasonCode: RECOMMENDATION_TRACE_ACCESS_REASON,
        accessedAt: NOW,
        expiresAt: new Date(
          NOW.getTime() + RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS * DAY_MS,
        ),
      },
    })
    expect(data?.episodes[0].facts.map((fact) => fact.sequence)).toEqual([
      1, 2, 3,
    ])
    expect(data?.episodes[0].facts[0]).toMatchObject({
      kind: "playback_start",
      metrics: { initiation: "manual", positionSeconds: 0 },
      occurredOutOfOrder: true,
    })
    expect(data?.episodes[0].facts[1]).toMatchObject({
      kind: "playback_end",
      metrics: {
        positionSeconds: 45,
        durationSeconds: 120,
        progress: 0.375,
        wallElapsedMilliseconds: 45_000,
        completed: false,
        reason: "route_exit",
      },
    })
    expect(data?.episodes[0].facts[2]).toMatchObject({
      kind: "playback_active_visible_playing",
      metrics: {
        activeMilliseconds: 1_000,
        coverage: "partial",
        missingReason: "visibility_unavailable",
      },
    })
    expect(data?.items[0]).toMatchObject({
      provenance: { sceneIndex: 3, similarity: 0.91 },
      presentation: {
        videoTitle: "Target video",
        audioLanguageSlug: "english",
      },
      explanation: "Selection arrived without an eligible impression.",
    })
    expect(data?.episodes[0].outcomes[1]).toMatchObject({
      classifierVersion: "active-watch-proxy-v1",
      activePlaybackMilliseconds: 1_000,
      durationSeconds: 120,
      durationCohort: "medium",
      activeCoverage: "partial",
      eligibilityState: "eligible",
      eligibleScopes: ["profile"],
    })
    expect(data?.contentActions).toEqual([
      expect.objectContaining({
        actionKind: "share",
        actionDetail: "link_copy",
        candidateGenerator: "semantic",
        replayCount: 1,
        learningEligible: false,
        eligibilityState: "pending",
      }),
    ])
    expect(data?.controlReadiness).toEqual({
      revision: 3,
      state: "ready",
      policyVersion: "semantic-control-readiness-v1",
      windowStart: new Date("2026-08-12T06:00:00.000Z"),
      windowEnd: new Date("2026-08-19T06:00:00.000Z"),
      evaluatedAt: new Date("2026-08-19T10:00:00.000Z"),
      explanation:
        "Semantic-only is ready to serve as a measurable control; no incremental viewer-value claim is made.",
    })
    expect(data?.experiment).toEqual({
      bypassReason: null,
      assignment: {
        id: "assignment-1",
        experimentId: "semantic-aa-v1",
        experimentVersion: "semantic-aa-v1",
        arm: "challenger",
        assignmentProbability: 0.5,
        configurationFingerprint: "b".repeat(12),
        generation: 1,
        effectiveManifestId: "semantic-experiment-aa-v1",
        actualExposureCount: 1,
      },
      evaluation: {
        revision: 2,
        state: "pass",
        inputFingerprint: "c".repeat(12),
        evaluatedAt: new Date("2026-08-19T11:00:00.000Z"),
      },
    })
    expect(data?.personalization).toEqual({
      lane: "profile_challenger",
      executionMode: "hybrid_personalized",
      effectiveManifestId: "semantic-profile-hybrid-v1",
      reasonCode: null,
      projectionScope: "durable",
      projectionVersion: "multi-interest-profile-projection-v1",
      projectionGeneration: 3,
      interestCount: 2,
      sessionIntentPresent: true,
      retrievalLatencyMs: 37,
      feedbackSourceRequestIds: ["prior-qualified-request"],
    })
    expect(data?.candidateExecution).toMatchObject({
      purpose: "watch",
      requestedCount: 6,
      composedCount: 1,
      shortfallReason: "eligibility_exhausted",
      evidenceComplete: true,
      parity: { candidateEligibility: "passed", ranker: "passed" },
      counts: { nominated: 2, deduplicated: 1, composed: 1 },
      stages: [
        expect.objectContaining({
          stage: "nominated",
          targetMediaId: "target-media",
          sourceCount: 1,
        }),
        expect.objectContaining({
          stage: "composed",
          finalPosition: 0,
          sourceCount: 2,
          sourceSummaries: expect.arrayContaining([
            "semantic · rank 1 · score 0.91",
            "multi-interest-profile · rank 1 · score 0.85",
          ]),
          contributors: expect.arrayContaining([
            expect.objectContaining({ generator: "semantic", rank: 1 }),
            expect.objectContaining({
              generator: "multi-interest-profile",
              rank: 1,
            }),
          ]),
        }),
      ],
    })
    expect(data?.items[0].composition).toMatchObject({
      finalPosition: 0,
      refill: true,
      contributors: expect.arrayContaining([
        expect.objectContaining({ generator: "semantic" }),
        expect.objectContaining({ generator: "multi-interest-profile" }),
      ]),
    })
    expect(data?.shadowComparisons).toEqual([
      expect.objectContaining({
        generatorVersion: "profile-interest-candidate-v1",
        liveSlateUnchanged: true,
        metrics: expect.objectContaining({ overlap: 0.5, diversity: 0.75 }),
        decision: expect.objectContaining({
          state: "promote_to_experiment",
          reasonCode: "shadow_evidence_meets_policy",
        }),
        nominations: [
          expect.objectContaining({
            generator: "profile-interest",
            overlapsLive: true,
            provenanceKeys: ["interestOrdinal"],
          }),
        ],
      }),
    ])
    expect(JSON.stringify(data)).not.toMatch(
      /Digest|capabilityJti|claimNonce|profileId|sessionId|watchHistory|profileVector|cookie/i,
    )
  })
})
