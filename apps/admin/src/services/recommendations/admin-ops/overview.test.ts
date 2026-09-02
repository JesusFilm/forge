import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  loadRecommendationOverview,
  resolveRecommendationOpsWindow,
  resolveRecommendationTraceFilters,
} from "@/services/recommendations/admin-ops"
import { recommendationManifestDigest } from "@/services/recommendations/promotion/manifest"

const NOW = new Date("2026-08-19T12:00:00.000Z")
const DAY_MS = 86_400_000

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
    recommendationPlaybackEvidenceControl: { findUnique: vi.fn() },
    recommendationPlaybackProxyEvaluation: { findFirst: vi.fn() },
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

describe("recommendation admin overview", () => {
  it("defaults to 24h and accepts only the bounded 7d/29d presets", () => {
    expect(resolveRecommendationOpsWindow(undefined, NOW)).toEqual({
      preset: "24h",
      start: new Date(NOW.getTime() - DAY_MS),
      end: NOW,
    })
    expect(resolveRecommendationOpsWindow("7d", NOW).start).toEqual(
      new Date(NOW.getTime() - 7 * DAY_MS),
    )
    expect(resolveRecommendationOpsWindow("29d", NOW).start).toEqual(
      new Date(NOW.getTime() - 29 * DAY_MS),
    )
    expect(resolveRecommendationOpsWindow("30d", NOW).preset).toBe("24h")

    expect(
      resolveRecommendationTraceFilters({
        requestState: "issued",
        fallbackReason: "semantic_timeout",
        evidenceState: "conflict",
      }),
    ).toEqual({
      requestState: "issued",
      fallbackReason: "semantic_timeout",
      evidenceState: "conflict",
    })
    expect(
      resolveRecommendationTraceFilters({
        requestState: "all",
        fallbackReason: "../../raw request",
        evidenceState: "unknown",
      }),
    ).toEqual({
      requestState: null,
      fallbackReason: null,
      evidenceState: null,
    })
  })

  it("loads aggregate-only scoped truth without a request list or identifiers", async () => {
    const prisma = prismaFixture()
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        preparedRequests: 1n,
        issuedRequests: 3n,
        issuanceFailedRequests: 1n,
        servedItems: 12n,
        renderedItems: 9n,
        impressions: 7n,
        selections: 4n,
        playbackStarts: 3n,
        finalizedEpisodes: 2n,
        fallbackRequests: 1n,
        committedRejections: 1n,
        writeFailures: 1n,
        lossSuspected: 2n,
        replays: 1n,
        conflicts: 1n,
        late: 1n,
        classifierLag: 1n,
        selectionWithoutImpression: 1n,
        retrievalP50Ms: 120,
        retrievalP95Ms: 420,
        deliverySuccessAt: new Date("2026-08-19T11:30:00.000Z"),
        evidenceSuccessAt: new Date("2026-08-19T11:45:00.000Z"),
        oldestPendingAt: new Date("2026-08-19T10:00:00.000Z"),
        eligibilityPending: 2n,
        eligibilityEligible: 3n,
        eligibilityExcluded: 1n,
        eligibilityQuarantined: 1n,
        eligibilityHumanAnonymous: 5n,
        eligibilityHumanSignedIn: 0n,
        eligibilityMachine: 1n,
        eligibilityInternal: 1n,
        eligibilityTest: 0n,
        eligibilityContamination: 0n,
        eligibilityReasonCounts: {
          actor_class_machine: 1,
          conflicting_evidence: 1,
        },
      },
    ])
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        latestSuccessAt: new Date("2026-08-19T09:00:00.000Z"),
        oldestOverdueAt: null,
      },
    ])
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        manifestEnabled: true,
        generationCount: 4n,
        durableGenerationCount: 3n,
        sessionGenerationCount: 1n,
        failedRunCount: 0n,
        coverage: 0.81,
        stability: 0.74,
        inputWatermark: new Date("2026-08-19T11:40:00.000Z"),
        expiryWatermark: new Date("2026-08-20T11:40:00.000Z"),
        interests: [
          {
            kind: "durable",
            ordinal: 0,
            generations: 3,
            stability: 0.78,
          },
          {
            kind: "session",
            ordinal: 0,
            generations: 1,
            stability: 1,
          },
        ],
      },
    ])
    prisma.recommendationShadowEvaluation.findFirst.mockResolvedValue({
      state: "TERMINAL",
      sampledCount: 40,
      processedCount: 38,
      failedCount: 2,
      coverage: 0.88,
      overlap: 0.42,
      novelty: 0.58,
      diversity: 0.71,
      cohortQuality: 0.8,
      latencyP95Ms: 920,
      inputWatermark: new Date("2026-08-19T11:42:00.000Z"),
      decision: {
        decision: "PROMOTE_TO_EXPERIMENT",
        reasonCode: "shadow_policy_passed",
        reevaluationCondition: "Re-evaluate after experiment design.",
      },
    })
    prisma.recommendationRetentionRun.findFirst.mockResolvedValue({
      completedAt: new Date("2026-08-19T09:00:00.000Z"),
    })
    prisma.recommendationRequest.findFirst.mockResolvedValue(null)
    prisma.recommendationServingControl.findUnique.mockResolvedValue({
      enabled: true,
      reasonCode: "enabled",
      manifest: {
        id: "semantic-transcript-pgvector-v1",
        strategyVersion: "semantic-transcript-pgvector-v1",
        contractVersion: "semantic-recommendation-v1",
        surfaceVersion: "watch-below-player-v1",
        generator: "semantic",
        maxItems: 6,
      },
    })
    prisma.recommendationControlEvaluation.findFirst.mockResolvedValue({
      id: "evaluation-safe-1",
      revision: 3,
      state: "READY",
      evaluatedAt: new Date("2026-08-19T10:00:00.000Z"),
      windowStart: new Date("2026-08-12T06:00:00.000Z"),
      windowEnd: new Date("2026-08-19T06:00:00.000Z"),
      inputCapturedAt: new Date("2026-08-19T10:00:00.000Z"),
      requestWatermark: new Date("2026-08-19T05:00:00.000Z"),
      impressionWatermark: new Date("2026-08-19T06:10:00.000Z"),
      selectionWatermark: new Date("2026-08-19T06:11:00.000Z"),
      outcomeWatermark: new Date("2026-08-19T09:00:00.000Z"),
      missionWatermark: new Date("2026-08-19T09:01:00.000Z"),
      eligibilityWatermark: new Date("2026-08-19T09:02:00.000Z"),
      manifestId: "semantic-transcript-pgvector-v1",
      strategyVersion: "semantic-transcript-pgvector-v1",
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      generator: "semantic",
      servingControlVersion: 7,
      policyVersion: "semantic-control-readiness-v1",
      outcomePolicyVersion: "watch-semantic-control-outcomes-v1",
      classifierVersion: "active-watch-proxy-v1",
      integrityPolicyVersion: "recommendation-integrity-v1",
      inputDigest: "a".repeat(64),
      manifestDigest: "b".repeat(64),
      deliveryOutcome: "PASS",
      attributionOutcome: "PASS",
      maturityOutcome: "PASS",
      operationalOutcome: "PASS",
      missionOutcome: "PASS",
      guardrailOutcome: "PASS",
      evidence: {
        issuedRequests: 200,
        matureOutcomes: 120,
        machineExcluded: 14,
      },
      rates: { ctr: 0.2, qualifiedOutcome: 0.39 },
      uncertainty: {
        method: "wilson-score-v1",
        confidenceLevel: 0.95,
        qualifiedOutcome: { lower: 0.3, upper: 0.48 },
      },
      reasonCodes: ["delivery_reliability_met"],
      explanation:
        "Semantic-only is ready to serve as a measurable control; no incremental viewer-value claim is made.",
      purpose: "semantic_control_readiness",
      identityClass: "aggregate_human_no_identity",
      accessClass: "recommendation_aggregate_readers",
      deletionBehavior: "scheduled_expiry",
      fallbackBehavior: "last_known_semantic_control",
      retentionDays: 365,
      supersedes: { revision: 2 },
    })
    prisma.recommendationExperimentEvaluation.findFirst.mockResolvedValue({
      id: "evaluation-aa-2",
      revision: 2,
      state: "PASS",
      evaluatedAt: new Date("2026-08-19T10:30:00.000Z"),
      windowStart: new Date("2026-08-12T06:00:00.000Z"),
      windowEnd: new Date("2026-08-19T06:00:00.000Z"),
      inputCapturedAt: new Date("2026-08-19T10:30:00.000Z"),
      assignmentWatermark: new Date("2026-08-19T10:30:00.000Z"),
      exposureWatermark: new Date("2026-08-19T10:30:00.000Z"),
      outcomeWatermark: new Date("2026-08-19T10:30:00.000Z"),
      missionWatermark: new Date("2026-08-19T10:30:00.000Z"),
      eligibilityWatermark: new Date("2026-08-19T10:30:00.000Z"),
      assignmentPolicyVersion: "sticky-deterministic-assignment-v1",
      outcomePolicyVersion: "active-watch-multi-outcome-v1",
      integrityPolicyVersion: "recommendation-integrity-v1",
      evaluationPolicyVersion: "recommendation-experiment-aa-v1",
      inputDigest: "c".repeat(64),
      counts: {
        controlAssigned: 100,
        challengerAssigned: 100,
        controlExposed: 80,
        challengerExposed: 75,
      },
      intentToTreat: {
        primary: true,
        control: { qualifiedRate: 0.2 },
        challenger: { qualifiedRate: 0.2 },
      },
      exposedOnly: { primary: false },
      uncertainty: { method: "wilson-score-v1" },
      guardrails: { passed: true },
      sampleRatio: { healthy: true },
      reasonCodes: ["aa_equivalence_guardrails_passed"],
      purpose: "multi_outcome_experiment_evaluation",
      identityClass: "aggregate_human_no_identity",
      accessClass: "recommendation_experiment_readers",
      deletionBehavior: "supersede_after_privacy_rebuild",
      fallbackBehavior: "semantic_control",
      retentionDays: 365,
      supersedes: { revision: 1 },
      experiment: {
        id: "semantic-aa-v1",
        experimentVersion: "semantic-aa-v1",
        surfaceVersion: "watch-below-player-v1",
        challengerProbability: 0.5,
        controlManifestId: "semantic-transcript-pgvector-v1",
        challengerManifestId: "semantic-experiment-aa-v1",
      },
    })
    const challengerManifest = {
      id: "semantic-experiment-aa-v1",
      strategyVersion: "semantic-experiment-aa-v1",
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      generator: "semantic",
      maxItems: 6,
      configuration: {
        behaviorallyEquivalentTo: "semantic-transcript-pgvector-v1",
        completeServiceDeadlineMs: 1_500,
        learningReads: false,
      },
      enabled: true,
    }
    prisma.recommendationPromotionPointer.findUnique.mockResolvedValue({
      id: "recommendation-promotion-pointer",
      activeManifestId: "semantic-experiment-aa-v1",
      activeManifest: challengerManifest,
      lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
      lastKnownGoodManifest: {
        id: "semantic-transcript-pgvector-v1",
        enabled: true,
      },
      stage: "BOUNDED",
      exposureCeilingBps: 5_000,
      generation: 2,
      killSwitchEnabled: false,
      reasonCode: "bounded_stage_active",
    })
    prisma.recommendationPromotionApproval.findFirst.mockResolvedValue({
      id: "approval-1",
      manifestId: challengerManifest.id,
      manifest: challengerManifest,
      manifestDigest: recommendationManifestDigest(challengerManifest),
      maxExposureBps: 5_000,
      approvedAt: new Date("2026-08-19T10:00:00.000Z"),
      expiresAt: new Date("2027-08-19T10:00:00.000Z"),
    })
    prisma.recommendationPromotionRun.findFirst.mockResolvedValue({
      id: "run-1",
      action: "ACTIVATE_BOUNDED",
      state: "COMPLETED",
      failureReason: null,
      createdAt: new Date("2026-08-19T10:10:00.000Z"),
      completedAt: new Date("2026-08-19T10:11:00.000Z"),
    })
    prisma.recommendationPromotionEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        eventType: "ACTIVATION_EFFECTIVE",
        fromManifestId: "semantic-transcript-pgvector-v1",
        toManifestId: challengerManifest.id,
        pointerGeneration: 2,
        reasonCode: "bounded_evaluation_passed",
        actorClass: "admin",
        occurredAt: new Date("2026-08-19T10:11:00.000Z"),
      },
    ])
    prisma.recommendationPlaybackEvidenceControl.findUnique.mockResolvedValue({
      id: "recommendation-playback-evidence-control",
      enabled: true,
      reasonCode: "bounded_collection",
      version: 2,
    })
    prisma.recommendationPlaybackProxyEvaluation.findFirst.mockResolvedValue({
      id: "playback-proxy-evaluation-2",
      revision: 2,
      state: "eligible_for_shadow_evaluation",
      inputWatermark: new Date("2026-08-19T09:30:00.000Z"),
      inputDigest: "d".repeat(64),
      reasonCodes: ["bounded_collection_quality_sufficient"],
      counts: {
        finalizedTotal: 100,
        activeOutcomeTotal: 99,
        completeCoverage: 98,
        writeFailureCount: 0,
        legacyQualifiedTotal: 55,
        proxyQualifiedTotal: 51,
        classificationDisagreements: 8,
      },
      cohorts: {
        medium: {
          total: 40,
          legacyQualified: 22,
          proxyQualified: 20,
          disagreements: 4,
        },
        sparse: {
          total: 3,
          legacyQualified: 2,
          proxyQualified: 1,
          disagreements: 1,
        },
      },
      metrics: {
        p95FinalizationLagMs: 70_000,
        conflictRate: 0.001,
        revisionRate: 0.02,
        retentionHealthy: true,
      },
      purpose: "offline_playback_proxy_readiness",
      identityClass: "aggregate_no_viewer_identity",
      accessClass: "recommendation_aggregate_readers",
      evaluatedAt: new Date("2026-08-19T10:00:00.000Z"),
      expiresAt: new Date("2027-08-19T10:00:00.000Z"),
    })

    const data = await loadRecommendationOverview(
      prisma as unknown as PrismaClient,
      { window: "24h", now: NOW },
    )

    const aggregateQuery = prisma.$queryRaw.mock.calls[0]?.[0]
    const aggregateSql = String(
      aggregateQuery.sql ?? aggregateQuery.text ?? aggregateQuery.strings,
    )
    expect(aggregateSql).toContain(
      "JOIN active_roots root ON root.id = audit.request_id",
    )
    expect(aggregateSql).toContain("audit.occurred_at >=")
    expect(aggregateSql).toContain("audit.occurred_at <")
    expect(aggregateSql).toContain("audit.kind IN")
    expect(aggregateSql).toContain(
      "terminal_fact.kind IN ('playback_end', 'playback_error')",
    )
    expect(aggregateSql).toContain(
      "episode.state IN ('finalized', 'timed_out')",
    )
    expect(aggregateSql).toContain("LEFT JOIN current_eligibility decision")
    expect(aggregateSql).toContain("decision.id IS NULL")
    expect(aggregateSql).toContain("decision.id IS NOT NULL")
    expect(aggregateSql).toContain("cardinality(decision.eligible_scopes)")
    expect(aggregateSql).not.toContain("session_digest AS")
    expect(aggregateSql).not.toContain("LEFT JOIN active_roots root")
    expect(prisma.recommendationRequest.findMany).not.toHaveBeenCalled()
    expect(JSON.stringify(data)).not.toMatch(
      /requestId|cursor|sessionDigest|tokenDigest|capabilityJti|claimNonce|raw[A-Z]/i,
    )
    expect(data).toMatchObject({
      window: { preset: "24h" },
      health: { primary: "loss_suspected" },
      counts: {
        preparedRequests: 1,
        issuedRequests: 3,
        servedItems: 12,
        playbackStarts: 3,
        committedRejections: 1,
        writeFailures: 1,
        lossSuspected: 2,
      },
      latency: { p50Ms: 120, p95Ms: 420 },
      eligibility: {
        pending: 2,
        eligible: 3,
        excluded: 1,
        quarantined: 1,
        actorClasses: {
          humanAnonymous: 5,
          humanSignedIn: 0,
          machine: 1,
          internal: 1,
          test: 0,
        },
        contamination: 0,
        reasonCodes: [
          { reasonCode: "actor_class_machine", count: 1 },
          { reasonCode: "conflicting_evidence", count: 1 },
        ],
      },
      controlReadiness: {
        state: "ready",
        revision: 3,
        dimensions: {
          delivery: "pass",
          attribution: "pass",
          maturity: "pass",
          operational: "pass",
          mission: "pass",
          guardrail: "pass",
        },
        evidence: expect.objectContaining({
          issuedRequests: 200,
          matureOutcomes: 120,
          machineExcluded: 14,
        }),
        rates: expect.objectContaining({
          ctr: 0.2,
          qualifiedOutcome: 0.39,
        }),
        inputDigest: "a".repeat(64),
        identityClass: "aggregate_human_no_identity",
        retentionDays: 365,
      },
      experimentEvaluation: {
        experimentId: "semantic-aa-v1",
        revision: 2,
        supersedesRevision: 1,
        state: "pass",
        expectedChallengerProbability: 0.5,
        counts: {
          controlAssigned: 100,
          challengerAssigned: 100,
          controlExposed: 80,
          challengerExposed: 75,
        },
        intentToTreat: expect.objectContaining({ primary: true }),
        inputDigest: "c".repeat(64),
      },
      promotion: {
        generation: 2,
        stage: "bounded",
        activeManifestId: "semantic-experiment-aa-v1",
        lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
        fallbackAvailable: true,
        exposureCeilingBps: 5_000,
        proposedExposureCeilingBps: 5_000,
        killSwitchEnabled: false,
        readiness: {
          ready: true,
          nextAction:
            "A recently authenticated Admin may confirm the permanent default.",
        },
        evaluationId: "evaluation-aa-2",
        workflow: { state: "complete" },
        conflictCount: 0,
        audit: [expect.objectContaining({ eventType: "activation_effective" })],
      },
      profileShadow: {
        manifestId: "multi-interest-profile-shadow-v1",
        manifestEnabled: true,
        shadowOnly: true,
        generationCount: 4,
        durableGenerationCount: 3,
        sessionGenerationCount: 1,
        metricsSuppressed: false,
        coverage: 0.81,
        stability: 0.74,
        interests: [
          expect.objectContaining({
            kind: "durable",
            ordinal: 0,
            generations: 3,
          }),
          expect.objectContaining({
            kind: "session",
            ordinal: 0,
            generations: 1,
          }),
        ],
        evaluation: expect.objectContaining({
          state: "terminal",
          decision: "PROMOTE_TO_EXPERIMENT",
          novelty: 0.58,
          diversity: 0.71,
        }),
      },
      playbackEvidence: {
        enabled: true,
        reasonCode: "bounded_collection",
        evaluation: {
          revision: 2,
          state: "eligible_for_shadow_evaluation",
          retentionHealthy: true,
          counts: {
            finalizedTotal: 100,
            activeOutcomeTotal: 99,
            completeCoverage: 98,
            writeFailureCount: 0,
            legacyQualifiedTotal: 55,
            proxyQualifiedTotal: 51,
            classificationDisagreements: 8,
          },
          metrics: {
            p95FinalizationLagMs: 70_000,
            conflictRate: 0.001,
            revisionRate: 0.02,
          },
          cohorts: [
            {
              cohort: "medium",
              count: 40,
              legacyQualified: 22,
              proxyQualified: 20,
              disagreements: 4,
              suppressed: false,
            },
            {
              cohort: "sparse",
              count: null,
              legacyQualified: null,
              proxyQualified: null,
              disagreements: null,
              suppressed: true,
            },
          ],
        },
      },
    })
    expect(
      prisma.recommendationControlEvaluation.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          expiresAt: { gt: NOW },
        },
      }),
    )
    expect(prisma.recommendationServingControl.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "recommendation-serving-control" },
      }),
    )
  })

  it("reports zero activity from a successful empty aggregate probe", async () => {
    const prisma = prismaFixture()
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        preparedRequests: 0n,
        issuedRequests: 0n,
        issuanceFailedRequests: 0n,
        servedItems: 0n,
        renderedItems: 0n,
        impressions: 0n,
        selections: 0n,
        playbackStarts: 0n,
        finalizedEpisodes: 0n,
        fallbackRequests: 0n,
        committedRejections: 0n,
        writeFailures: 0n,
        lossSuspected: 0n,
        replays: 0n,
        conflicts: 0n,
        late: 0n,
        classifierLag: 0n,
        selectionWithoutImpression: 0n,
        retrievalP50Ms: null,
        retrievalP95Ms: null,
        deliverySuccessAt: new Date("2026-08-18T11:30:00.000Z"),
        evidenceSuccessAt: null,
        oldestPendingAt: null,
      },
    ])
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        latestSuccessAt: new Date("2026-08-19T09:00:00.000Z"),
        oldestOverdueAt: null,
      },
    ])
    prisma.recommendationRetentionRun.findFirst.mockResolvedValue({
      completedAt: new Date("2026-08-19T09:00:00.000Z"),
    })
    prisma.recommendationRequest.findFirst.mockResolvedValue(null)
    prisma.recommendationServingControl.findUnique.mockResolvedValue(null)

    const data = await loadRecommendationOverview(
      prisma as unknown as PrismaClient,
      { now: NOW },
    )

    expect(data.health.primary).toBe("zero_activity")
    expect(data.counts).toMatchObject({
      preparedRequests: 0,
      issuedRequests: 0,
      issuanceFailedRequests: 0,
    })
    expect(data.watermarks).toMatchObject({
      deliverySuccessAt: new Date("2026-08-18T11:30:00.000Z"),
      evidenceSuccessAt: null,
      retentionSuccessAt: new Date("2026-08-19T09:00:00.000Z"),
    })
  })

  it("reports unknown when an empty window has no durable success watermark", async () => {
    const prisma = prismaFixture()
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        preparedRequests: 0n,
        issuedRequests: 0n,
        issuanceFailedRequests: 0n,
        servedItems: 0n,
        renderedItems: 0n,
        impressions: 0n,
        selections: 0n,
        playbackStarts: 0n,
        finalizedEpisodes: 0n,
        fallbackRequests: 0n,
        committedRejections: 0n,
        writeFailures: 0n,
        lossSuspected: 0n,
        replays: 0n,
        conflicts: 0n,
        late: 0n,
        classifierLag: 0n,
        selectionWithoutImpression: 0n,
        retrievalP50Ms: null,
        retrievalP95Ms: null,
        deliverySuccessAt: null,
        evidenceSuccessAt: null,
        oldestPendingAt: null,
      },
    ])
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        latestSuccessAt: new Date("2026-08-19T09:00:00.000Z"),
        oldestOverdueAt: null,
      },
    ])
    prisma.recommendationRetentionRun.findFirst.mockResolvedValue({
      completedAt: new Date("2026-08-19T09:00:00.000Z"),
    })
    prisma.recommendationRequest.findFirst.mockResolvedValue(null)
    prisma.recommendationServingControl.findUnique.mockResolvedValue(null)

    const data = await loadRecommendationOverview(
      prisma as unknown as PrismaClient,
      { now: NOW },
    )

    expect(data).toMatchObject({
      health: { primary: "unavailable_unknown" },
      counts: null,
      latency: null,
    })
  })

  it("returns unknown rather than exact zero counts when the aggregate probe fails", async () => {
    const prisma = prismaFixture()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    prisma.$queryRaw.mockRejectedValue(new Error("database unavailable"))

    const data = await loadRecommendationOverview(
      prisma as unknown as PrismaClient,
      { now: NOW },
    )

    expect(data).toMatchObject({
      health: { primary: "unavailable_unknown" },
      counts: null,
      latency: null,
    })
    expect(JSON.stringify(data)).not.toContain('"requests":0')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      "recommendation.admin_overview.unavailable reason_code=aggregate_read_failed",
    )
    warn.mockRestore()
  })
})
