import { createHmac } from "node:crypto"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const requireSessionMock = vi.fn()
const loadOverviewMock = vi.fn()
const loadTracePageMock = vi.fn()
const loadDetailMock = vi.fn()
const loadPlaybackTracePageMock = vi.fn()
const loadPlaybackDetailMock = vi.fn()
const redirectMock = vi.fn((destination: string) => {
  throw new Error(`REDIRECT:${destination}`)
})

vi.mock("@/auth/session", () => ({
  requireSession: () => requireSessionMock(),
}))

vi.mock("@/db/client", () => ({ prisma: {} }))

vi.mock("@/config/env", () => ({
  env: {
    ADMIN_SESSION_SECRET: "test-admin-session-secret-at-least-32-chars",
  },
}))

vi.mock("@/services/recommendations/admin-ops", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/recommendations/admin-ops")
    >()
  return {
    ...actual,
    loadRecommendationOverview: (...args: unknown[]) =>
      loadOverviewMock(...args),
    loadRecommendationTracePage: (...args: unknown[]) =>
      loadTracePageMock(...args),
    loadRecommendationRequestDetail: (...args: unknown[]) =>
      loadDetailMock(...args),
    loadRecommendationPlaybackTracePage: (...args: unknown[]) =>
      loadPlaybackTracePageMock(...args),
    loadRecommendationPlaybackContextDetail: (...args: unknown[]) =>
      loadPlaybackDetailMock(...args),
  }
})

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND")
  }),
  redirect: (destination: string) => redirectMock(destination),
}))

import RecommendationsPage from "./page"
import RecommendationRequestPage from "./[requestId]/page"
import RecommendationPlaybackContextPage from "./playback/[contextId]/page"

const overview = {
  window: {
    preset: "24h",
    start: new Date("2026-08-18T12:00:00.000Z"),
    end: new Date("2026-08-19T12:00:00.000Z"),
  },
  health: { primary: "zero_activity", states: ["zero_activity"] },
  counts: {
    preparedRequests: 0,
    issuedRequests: 0,
    issuanceFailedRequests: 0,
    servedItems: 0,
    renderedItems: 0,
    impressions: 0,
    selections: 0,
    playbackStarts: 0,
    finalizedEpisodes: 0,
    fallbackRequests: 0,
    committedRejections: 0,
    writeFailures: 0,
    lossSuspected: 0,
    replays: 0,
    conflicts: 0,
    late: 0,
    classifierLag: 0,
    selectionWithoutImpression: 0,
  },
  latency: { p50Ms: null, p95Ms: null },
  watermarks: {
    deliverySuccessAt: null,
    evidenceSuccessAt: null,
    retentionSuccessAt: new Date("2026-08-19T09:00:00.000Z"),
    databaseProbeAt: new Date("2026-08-19T12:00:00.000Z"),
  },
  oldestPendingAt: null,
  eligibility: {
    pending: 2,
    eligible: 3,
    excluded: 1,
    quarantined: 1,
    actorClasses: {
      humanAnonymous: 5,
      humanSignedIn: 0,
      machine: 1,
      internal: 0,
      test: 0,
    },
    contamination: 0,
    reasonCodes: [{ reasonCode: "actor_class_machine", count: 1 }],
  },
  privacy: {
    profiles: {
      active: 2,
      tombstoned: 1,
      expired: 0,
      pendingErasure: 0,
      failedErasure: 0,
    },
    transitions: { grant: 2, reset: 1, withdraw: 1, delete: 0, expire: 0 },
    staleWorkerRejections: 1,
    lastDeletionDrillAt: new Date("2026-08-19T08:00:00.000Z"),
    latestTransition: {
      kind: "withdraw",
      fromGeneration: 2,
      toGeneration: null,
      erasureState: "completed",
      occurredAt: new Date("2026-08-19T10:00:00.000Z"),
    },
  },
  retention: {
    healthy: true,
    reason: "healthy",
    latestSuccessAt: new Date("2026-08-19T09:00:00.000Z"),
    oldestOverdueAt: null,
  },
  serving: {
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
  },
  controlReadiness: {
    state: "ready",
    revision: 3,
    evaluatedAt: new Date("2026-08-19T10:00:00.000Z"),
    window: {
      start: new Date("2026-08-12T06:00:00.000Z"),
      end: new Date("2026-08-19T06:00:00.000Z"),
      inputCapturedAt: new Date("2026-08-19T10:00:00.000Z"),
    },
    watermarks: {
      request: new Date("2026-08-19T05:00:00.000Z"),
      impression: new Date("2026-08-19T06:10:00.000Z"),
      selection: new Date("2026-08-19T06:11:00.000Z"),
      outcome: new Date("2026-08-19T09:00:00.000Z"),
      mission: new Date("2026-08-19T09:01:00.000Z"),
      eligibility: new Date("2026-08-19T09:02:00.000Z"),
    },
    manifestId: "semantic-transcript-pgvector-v1",
    strategyVersion: "semantic-transcript-pgvector-v1",
    contractVersion: "semantic-recommendation-v1",
    surfaceVersion: "watch-below-player-v1",
    servingControlVersion: 7,
    policyVersion: "semantic-control-readiness-v1",
    outcomePolicyVersion: "watch-semantic-control-outcomes-v1",
    classifierVersion: "active-watch-proxy-v1",
    integrityPolicyVersion: "recommendation-integrity-v1",
    inputDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    dimensions: {
      delivery: "pass",
      attribution: "pass",
      maturity: "pass",
      operational: "pass",
      mission: "pass",
      guardrail: "pass",
    },
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
    supersedesRevision: 2,
  },
  experimentEvaluation: null,
  promotion: {
    generation: 2,
    stage: "bounded",
    activeManifestId: "semantic-experiment-aa-v1",
    targetManifestId: "semantic-experiment-aa-v1",
    lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
    fallbackAvailable: true,
    exposureCeilingBps: 5_000,
    proposedExposureCeilingBps: 5_000,
    killSwitchEnabled: false,
    reasonCode: "bounded_stage_active",
    readiness: {
      ready: true,
      reason: "The bounded stage is active with mature guardrails.",
      nextAction:
        "A recently authenticated Admin may confirm the permanent default.",
      impact:
        "50% of eligible assignments may receive the approved challenger.",
      restore: "semantic-transcript-pgvector-v1",
    },
    approval: {
      id: "approval-1",
      manifestDigest: "a".repeat(64),
      maxExposureBps: 5_000,
      approvedAt: new Date("2026-08-19T09:00:00.000Z"),
      expiresAt: new Date("2027-08-19T09:00:00.000Z"),
    },
    evaluationId: "evaluation-1",
    evaluationState: "pass",
    workflow: {
      id: "run-1",
      action: "activate_bounded",
      state: "complete",
      failureReason: null,
      createdAt: new Date("2026-08-19T09:10:00.000Z"),
      completedAt: new Date("2026-08-19T09:11:00.000Z"),
    },
    conflictCount: 0,
    audit: [
      {
        id: "event-1",
        eventType: "activation_effective",
        fromManifestId: "semantic-transcript-pgvector-v1",
        toManifestId: "semantic-experiment-aa-v1",
        pointerGeneration: 2,
        reasonCode: "bounded_evaluation_passed",
        actorClass: "admin",
        occurredAt: new Date("2026-08-19T09:11:00.000Z"),
      },
    ],
  },
  profileShadow: {
    manifestId: "multi-interest-profile-shadow-v1",
    manifestEnabled: true,
    shadowOnly: true,
    generationCount: 4,
    durableGenerationCount: 3,
    sessionGenerationCount: 1,
    failedRunCount: 0,
    metricsSuppressed: false,
    coverage: 0.81,
    stability: 0.74,
    inputWatermark: new Date("2026-08-19T11:40:00.000Z"),
    expiryWatermark: new Date("2026-08-20T11:40:00.000Z"),
    interests: [
      { kind: "durable", ordinal: 0, generations: 3, stability: 0.78 },
      { kind: "session", ordinal: 0, generations: 1, stability: 1 },
    ],
    evaluation: {
      state: "terminal",
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
      decision: "PROMOTE_TO_EXPERIMENT",
      reasonCode: "shadow_policy_passed",
      reevaluationCondition: "Re-evaluate after experiment design.",
    },
  },
  playbackEvidence: {
    enabled: true,
    reasonCode: "bounded_collection",
    evaluation: {
      revision: 2,
      state: "eligible_for_shadow_evaluation",
      evaluatedAt: new Date("2026-08-19T10:00:00.000Z"),
      inputWatermark: new Date("2026-08-19T09:30:00.000Z"),
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
      metrics: {
        p95FinalizationLagMs: 70_000,
        conflictRate: 0.001,
        revisionRate: 0.02,
      },
      retentionHealthy: true,
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
}

describe("Admin Recommendations pages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadOverviewMock.mockResolvedValue(overview)
    loadTracePageMock.mockResolvedValue({
      window: overview.window,
      filters: {
        requestState: null,
        fallbackReason: null,
        evidenceState: null,
      },
      rows: [
        {
          id: "request-private-1",
          state: "issued",
          result: "served",
          fallbackReason: null,
          strategyVersion: "semantic-transcript-pgvector-v1",
          classifierVersion: "legacy-position-v0",
          locale: "en",
          expectedItemCount: 2,
          retrievalLatencyMs: 110,
          responseBytes: 2_048,
          createdAt: new Date("2026-08-19T11:00:00.000Z"),
          issuedAt: new Date("2026-08-19T11:00:00.010Z"),
          counts: {
            items: 2,
            rendered: 2,
            impressions: 1,
            selections: 1,
            episodes: 1,
            outcomes: 0,
            conflicts: 0,
          },
        },
      ],
      nextCursor: "opaque-private-cursor",
    })
    loadPlaybackTracePageMock.mockResolvedValue({
      window: overview.window,
      rows: [
        {
          id: "context-private-1",
          source: "direct",
          mediaId: "target-media",
          recommendationAttributed: false,
          sourceReferencePresent: false,
          generation: 1,
          createdAt: new Date("2026-08-19T11:10:00.000Z"),
          expiresAt: new Date("2026-09-17T11:10:00.000Z"),
          episode: {
            id: "episode-private-1",
            state: "finalized",
            generation: 2,
            claimedAt: new Date("2026-08-19T11:10:01.000Z"),
            finalizedAt: new Date("2026-08-19T11:11:00.000Z"),
            activeUntil: new Date("2026-08-19T15:10:00.000Z"),
            hardUntil: new Date("2026-08-20T11:10:00.000Z"),
            facts: 3,
            outcomes: 1,
          },
          conflicts: 0,
          writeFailures: 0,
        },
      ],
    })
  })

  it("renders aggregate truth for EDITOR without requesting or leaking trace data", async () => {
    requireSessionMock.mockResolvedValue({ id: "editor-1", role: "EDITOR" })

    const html = renderToStaticMarkup(
      await RecommendationsPage({ searchParams: Promise.resolve({}) }),
    )

    expect(loadOverviewMock).toHaveBeenCalledOnce()
    expect(loadTracePageMock).not.toHaveBeenCalled()
    expect(loadPlaybackTracePageMock).not.toHaveBeenCalled()
    expect(html).toContain("Zero activity")
    expect(html).toContain("No request roots exist in this healthy window")
    expect(html).toContain("Request traces require Admin access")
    expect(html).toContain("Learning eligibility")
    expect(html).toContain("Pending explicit classification")
    expect(html).toContain("Actor Class Machine")
    expect(html).toContain("Privacy and continuity")
    expect(html).toContain("Semantic control readiness")
    expect(html).toContain("Ready")
    expect(html).toContain("Delivery")
    expect(html).toContain("Attribution")
    expect(html).toContain("Guardrail")
    expect(html).toContain("200 issued human requests")
    expect(html).toContain("Machine excluded: 14")
    expect(html).toContain("no incremental viewer-value claim")
    expect(html).toContain("Aggregate Human No Identity")
    expect(html).toContain("365 days")
    expect(html).toContain("Last Known Semantic Control")
    expect(html).toContain("Raw cookies, digests, session links")
    expect(html).toContain("Promotion decision")
    expect(html).toContain("50% of eligible assignments")
    expect(html).toContain("Read-only evidence")
    expect(html).toContain("Activation Effective")
    expect(html).toContain("Profile candidate shadow")
    expect(html).toContain("MULTI-INTEREST")
    expect(html).toContain("PROMOTE TO EXPERIMENT")
    expect(html).toContain("NO LIVE TRAFFIC")
    expect(html).toContain("Source-neutral playback evidence")
    expect(html).toContain(
      "Collection quality is sufficient for offline shadow evaluation only",
    )
    expect(html).toContain("Missing proxy outcomes")
    expect(html).toContain("Legacy qualified")
    expect(html).toContain("Proxy qualified")
    expect(html).toContain("40 total")
    expect(html).toContain("Suppressed (&lt;10)")
    expect(html).not.toContain("private-profile")
    expect(html).not.toContain("request-private-1")
    expect(html).not.toContain("opaque-private-cursor")
    expect(html).not.toContain("/dashboard/recommendations/request-private-1")
    expect(html).not.toContain("context-private-1")
  })

  it("renders the active-root request list and links only for ADMIN", async () => {
    requireSessionMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" })

    const html = renderToStaticMarkup(
      await RecommendationsPage({
        searchParams: Promise.resolve({ window: "7d" }),
      }),
    )

    expect(loadTracePageMock).toHaveBeenCalledOnce()
    expect(loadPlaybackTracePageMock).toHaveBeenCalledOnce()
    expect(html).toContain("Request traces")
    expect(html).toContain("request-private-1")
    expect(html).toContain("/dashboard/recommendations/request-private-1")
    expect(html).toContain("cursor=opaque-private-cursor")
    expect(html).toContain("context-private-1")
    expect(html).toContain(
      "/dashboard/recommendations/playback/context-private-1",
    )
    expect(html).toContain("Source is diagnostic provenance only")
    expect(html).toContain("Confirm permanent default")
    expect(html).toContain("Restore last-known-good")
    expect(html).toContain("Emergency stop")
  })

  it.each([
    {
      label: "disabled",
      playbackEvidence: {
        enabled: false,
        reasonCode: "operator_disabled",
        evaluation: null,
      },
      copy: "Collection is disabled. Playback remains available",
    },
    {
      label: "inconclusive",
      playbackEvidence: {
        ...overview.playbackEvidence,
        evaluation: {
          ...overview.playbackEvidence.evaluation,
          state: "inconclusive",
        },
      },
      copy: "Evidence is inconclusive",
    },
    {
      label: "revise",
      playbackEvidence: {
        ...overview.playbackEvidence,
        evaluation: {
          ...overview.playbackEvidence.evaluation,
          state: "revise",
        },
      },
      copy: "Collection quality is degraded",
    },
    {
      label: "retire",
      playbackEvidence: {
        ...overview.playbackEvidence,
        evaluation: {
          ...overview.playbackEvidence.evaluation,
          state: "retire",
        },
      },
      copy: "Retire this proxy",
    },
  ])(
    "renders $label playback evidence state",
    async ({ playbackEvidence, copy }) => {
      requireSessionMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
      loadOverviewMock.mockResolvedValue({ ...overview, playbackEvidence })

      const html = renderToStaticMarkup(
        await RecommendationsPage({ searchParams: Promise.resolve({}) }),
      )

      expect(html).toContain(copy)
    },
  )

  it("shows rollback only for a historical profile-only promotion pointer", async () => {
    requireSessionMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
    loadOverviewMock.mockResolvedValue({
      ...overview,
      promotion: {
        ...overview.promotion,
        activeManifestId: "multi-interest-profile-pilot-v1",
        targetManifestId: null,
        approval: null,
        exposureCeilingBps: 100,
        proposedExposureCeilingBps: 500,
        readiness: {
          ...overview.promotion.readiness,
          ready: false,
          reason: "The exact manifest digest is not pre-approved.",
          nextAction: "Review and approve the current immutable manifest.",
        },
      },
    })

    const html = renderToStaticMarkup(
      await RecommendationsPage({ searchParams: Promise.resolve({}) }),
    )

    expect(html).toContain("exact manifest digest")
    expect(html).not.toContain("Approve exact manifest")
    expect(html).not.toContain("Increase bounded stage")
    expect(html).not.toContain("Confirm permanent default")
    expect(html).toContain("Restore last-known-good")
    expect(html).toContain("Emergency stop")
  })

  it("denies the overview before any recommendation reader runs", async () => {
    requireSessionMock.mockResolvedValue({ id: "viewer-1", role: "VIEWER" })

    await expect(
      RecommendationsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/dashboard")
    expect(loadOverviewMock).not.toHaveBeenCalled()
    expect(loadTracePageMock).not.toHaveBeenCalled()
    expect(loadPlaybackTracePageMock).not.toHaveBeenCalled()
  })

  it("denies a crafted detail URL to EDITOR before loading or auditing", async () => {
    requireSessionMock.mockResolvedValue({ id: "editor-1", role: "EDITOR" })

    await expect(
      RecommendationRequestPage({
        params: Promise.resolve({ requestId: "request-private-1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("REDIRECT:/dashboard/recommendations")
    expect(loadDetailMock).not.toHaveBeenCalled()
  })

  it("denies a crafted playback detail URL to EDITOR before loading or auditing", async () => {
    requireSessionMock.mockResolvedValue({ id: "editor-1", role: "EDITOR" })

    await expect(
      RecommendationPlaybackContextPage({
        params: Promise.resolve({ contextId: "context-private-1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("REDIRECT:/dashboard/recommendations")
    expect(loadPlaybackDetailMock).not.toHaveBeenCalled()
  })

  it("renders an audited privacy-safe playback detail for ADMIN", async () => {
    requireSessionMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
    loadPlaybackDetailMock.mockResolvedValue({
      context: {
        id: "context-private-1",
        source: "direct",
        mediaId: "target-media",
        recommendationAttributed: false,
        sourceReferencePresent: false,
        generation: 1,
        createdAt: new Date("2026-08-19T11:10:00.000Z"),
        expiresAt: new Date("2026-09-17T11:10:00.000Z"),
        episode: {
          id: "episode-private-1",
          state: "finalized",
          generation: 2,
          claimedAt: new Date("2026-08-19T11:10:01.000Z"),
          finalizedAt: new Date("2026-08-19T11:11:00.000Z"),
          activeUntil: new Date("2026-08-19T15:10:00.000Z"),
          hardUntil: new Date("2026-08-20T11:10:00.000Z"),
          facts: 2,
          outcomes: 1,
        },
        conflicts: 0,
        writeFailures: 0,
      },
      facts: [
        {
          sequence: 1,
          kind: "playback_active_visible_playing",
          occurredAt: new Date("2026-08-19T11:10:31.000Z"),
          receivedAt: new Date("2026-08-19T11:10:31.100Z"),
          late: false,
          positionSeconds: null,
          durationSeconds: null,
          fromSeconds: null,
          toSeconds: null,
          activeMilliseconds: null,
          startedAt: "2026-08-19T11:10:01.000Z",
          endedAt: "2026-08-19T11:10:31.000Z",
        },
      ],
      outcomes: [
        {
          classifierVersion: "active-watch-proxy-v1",
          revision: 1,
          qualifiedView: true,
          viewQualityWeight: 0.25,
          viewQualityWeightReason: "active_fraction_of_duration",
          activePlaybackMilliseconds: 30_000,
          durationSeconds: 120,
          durationCohort: "medium",
          activeCoverage: "complete",
          reasons: ["active_visible_playing_at_least_30_seconds"],
          generation: 2,
          createdAt: new Date("2026-08-19T11:11:00.000Z"),
          eligibility: {
            state: "eligible",
            actorClass: "human_anonymous",
            eligibleScopes: ["profile"],
            contributionWeight: 0.25,
            reasonCodes: [],
          },
        },
      ],
      audits: [],
      conflicts: [],
    })

    const html = renderToStaticMarkup(
      await RecommendationPlaybackContextPage({
        params: Promise.resolve({ contextId: "context-private-1" }),
        searchParams: Promise.resolve({ window: "24h" }),
      }),
    )

    expect(loadPlaybackDetailMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contextId: "context-private-1",
        actorDigest: createHmac(
          "sha256",
          "test-admin-session-secret-at-least-32-chars",
        )
          .update("recommendation-trace-actor:v1\0")
          .update("admin-1")
          .digest("hex"),
      }),
    )
    expect(html).toContain("Privacy-safe playback trace")
    expect(html).toContain("SOURCE IS DIAGNOSTIC ONLY")
    expect(html).toContain("Recommendation attribution")
    expect(html).toContain("Absent")
    expect(html).toContain("Playback Active Visible Playing")
    expect(html).toContain("Qualified")
    expect(html).toContain("Viewer identity, URLs, digests, tokens")
    expect(html).not.toContain("admin-1")
    expect(html).not.toMatch(
      /sessionDigest|sourceRefDigest|capabilityJti|eventId/,
    )
  })

  it("renders a privacy-safe detail for ADMIN", async () => {
    requireSessionMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" })
    loadDetailMock.mockResolvedValue({
      id: "request-private-1",
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      strategyVersion: "semantic-transcript-pgvector-v1",
      classifierVersion: "legacy-position-v0",
      seedMediaId: "seed-media",
      locale: "en",
      expectedItemCount: 1,
      state: "issued",
      result: "served",
      fallbackReason: null,
      retrievalLatencyMs: 110,
      responseBytes: 2_048,
      createdAt: new Date("2026-08-19T10:00:00.000Z"),
      issuedAt: new Date("2026-08-19T10:00:00.010Z"),
      manifest: {
        id: "semantic-transcript-pgvector-v1",
        strategyVersion: "semantic-transcript-pgvector-v1",
        contractVersion: "semantic-recommendation-v1",
        surfaceVersion: "watch-below-player-v1",
        generator: "semantic",
        maxItems: 6,
      },
      controlReadiness: {
        revision: 3,
        state: "ready",
        policyVersion: "semantic-control-readiness-v1",
        windowStart: new Date("2026-08-12T06:00:00.000Z"),
        windowEnd: new Date("2026-08-19T06:00:00.000Z"),
        evaluatedAt: new Date("2026-08-19T10:00:00.000Z"),
        explanation:
          "Semantic-only is ready to serve as a measurable control; no incremental viewer-value claim is made.",
      },
      personalization: {
        lane: "profile_challenger",
        effectiveManifestId: "multi-interest-profile-pilot-v1",
        reasonCode: null,
        projectionScope: "durable",
        projectionVersion: "multi-interest-profile-projection-v1",
        projectionGeneration: 3,
        interestCount: 2,
        sessionIntentPresent: true,
        retrievalLatencyMs: 37,
        feedbackSourceRequestIds: ["prior-qualified-request"],
      },
      candidateExecution: {
        purpose: "watch",
        versions: {
          context: "recommendation-context-v1",
          generator: "semantic-transcript-candidate-v1",
          union: "canonical-video-union-v1",
          eligibility: "watch-playable-locale-v1",
          ranker: "semantic-deterministic-ranker-v1",
          composer: "minimal-playable-slate-v1",
        },
        parity: { candidateEligibility: "passed", ranker: "passed" },
        counts: {
          nominated: 2,
          canonicalized: 2,
          deduplicated: 1,
          rejected: 0,
          scored: 1,
          ordered: 1,
          composed: 1,
        },
        evidenceComplete: true,
        fallbackReason: null,
        stages: [
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
              "semantic · rank 2 · score 0.85",
            ],
            normalizedScore: null,
            rrfScore: null,
            deterministicScore: 1,
            finalPosition: 0,
            reasonCodes: ["playable_localized_deduplicated"],
          },
        ],
      },
      shadowComparisons: [
        {
          evaluationId: "shadow-evaluation-1",
          runId: "shadow-run-1",
          generatorVersion: "profile-interest-candidate-v1",
          evaluationState: "terminal",
          runState: "published",
          sampleOrdinal: 0,
          versions: {
            sampling: "stable-request-hash-v1",
            context: "recommendation-context-v1",
            eligibility: "watch-playable-locale-v1",
            retention: "request-root-29d-aggregate-365d-v1",
          },
          usedProfileProjection: true,
          privacyGeneration: 4,
          liveSlateUnchanged: true,
          counts: { nominated: 2, eligible: 1, rejected: 1 },
          metrics: {
            coverage: 1,
            overlap: 0.5,
            novelty: 0.5,
            diversity: 0.75,
            rejection: 0.5,
            latencyMs: 241,
            cohortQuality: 0.82,
            inputFreshnessMs: 1_000,
          },
          inputCapturedAt: new Date("2026-08-19T10:00:00.000Z"),
          finishedAt: new Date("2026-08-19T10:01:00.000Z"),
          decision: {
            state: "promote_to_experiment",
            reasonCode: "shadow_evidence_meets_policy",
            reevaluationCondition:
              "reopen_if_manifest_or_eligibility_version_changes",
            decidedAt: new Date("2026-08-19T11:00:00.000Z"),
          },
          nominations: [
            {
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
          ],
        },
      ],
      items: [
        {
          id: "item-1",
          position: 0,
          targetMediaId: "target-media",
          canonicalHref: "/watch/target.html/english.html",
          candidateGenerator: "semantic",
          provenance: { sceneIndex: 3, similarity: 0.91 },
          presentation: {
            videoTitle: "Target video",
            audioLanguageSlug: "english",
          },
          renderedAt: new Date("2026-08-19T10:00:02.000Z"),
          impressionAt: null,
          selectedAt: new Date("2026-08-19T10:00:03.000Z"),
          visibilityPolicy: null,
          explanation: "Selection arrived without an eligible impression.",
        },
      ],
      lifecycleEvents: [],
      episodes: [
        {
          id: "episode-1",
          itemId: "item-1",
          state: "finalized",
          mediaId: "target-media",
          createdAt: new Date("2026-08-19T10:00:03.000Z"),
          claimedAt: new Date("2026-08-19T10:00:04.000Z"),
          finalizedAt: new Date("2026-08-19T10:00:30.000Z"),
          activeUntil: new Date("2026-08-19T14:00:03.000Z"),
          facts: [],
          outcomes: [
            {
              id: "outcome-1",
              classifierVersion: "legacy-position-v0",
              factWatermark: 2,
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
              classifierVersion: "active-watch-proxy-v1",
              factWatermark: 2,
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
          ],
        },
      ],
      contentActions: [],
      audits: [],
      conflicts: [],
    })

    const html = renderToStaticMarkup(
      await RecommendationRequestPage({
        params: Promise.resolve({ requestId: "request-private-1" }),
        searchParams: Promise.resolve({ window: "24h" }),
      }),
    )

    expect(loadDetailMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requestId: "request-private-1",
        actorDigest: createHmac(
          "sha256",
          "test-admin-session-secret-at-least-32-chars",
        )
          .update("recommendation-trace-actor:v1\0")
          .update("admin-1")
          .digest("hex"),
      }),
    )
    expect(JSON.stringify(loadDetailMock.mock.calls)).not.toContain("admin-1")
    expect(html).toContain("Selection arrived without an eligible impression")
    expect(html).toContain("No impression")
    expect(html).toContain("Pending")
    expect(html).toContain("Eligible")
    expect(html).toContain("Aggregate Distinct Support Pending")
    expect(html).toContain("Active playback")
    expect(html).toContain("1.0 seconds")
    expect(html).toContain("Partial coverage")
    expect(html).toContain("sanitized 90-day operator audit")
    expect(html).toContain("Control readiness revision 3")
    expect(html).toContain("Personalization decision")
    expect(html).toContain("prior-qualified-request")
    expect(html).toContain("This request belongs to the pinned input window")
    expect(html).toContain("Candidate execution")
    expect(html).toContain("Live versus shadow candidates")
    expect(html).toContain("Live slate untouched")
    expect(html).toContain("Promote To Experiment")
    expect(html).toContain("Shadow Evidence Meets Policy")
    expect(html).toContain("profile-interest")
    expect(html).toContain("Candidate / eligibility parity")
    expect(html).toContain("Deterministic ranker parity")
    expect(html).toContain("Nominated")
    expect(html).toContain("Composed")
    expect(html).not.toContain("admin-1")
    expect(html).not.toMatch(
      /sessionDigest|capabilityJti|claimNonce|rawTranscript/,
    )
  })
})
