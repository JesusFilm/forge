import { afterEach, describe, expect, it, vi } from "vitest"
import { HYBRID_PERSONALIZED_MANIFEST_ID } from "./promotion/manifest"
import { VideoNotFoundError } from "@/services/scene-recommendations.service"

import {
  candidate,
  input,
  makeHarness,
  personalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "./delivery.service.test-helpers"

afterEach(() => {
  vi.useRealTimers()
})

describe("RecommendationDeliveryService", () => {
  it("uses an authorized profile directly without shadow or promotion assignment", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: null,
      bypassReason: "promotion_not_active",
    })
    harness.retrieveProfile.mockResolvedValue(profileCandidateResult)
    harness.retrieve.mockResolvedValue(semanticCandidates(6))

    const delivery = await harness.service.deliver(
      personalizedInput("direct-profile-seed"),
    )

    expect(harness.assignExperiment).not.toHaveBeenCalled()
    expect(harness.signDeliveryCapability).toHaveBeenCalledWith(
      expect.not.objectContaining({ assignmentId: expect.anything() }),
    )
    expect(
      harness.tx.recommendationRequest.create.mock.calls[0]?.[0].data,
    ).toMatchObject({
      experimentAssignmentId: null,
      experimentBypassReason: null,
    })
    expect(harness.retrieveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        profileTokenDigest: "d".repeat(64),
        manifestId: "semantic-transcript-pgvector-v1",
      }),
    )
    expect(delivery).toMatchObject({
      result: "served",
      reason: null,
      personalization: {
        lane: "profile_challenger",
        executionMode: "hybrid_personalized",
        effectiveManifestId: "semantic-transcript-pgvector-v1",
        interestCount: 1,
        reason: null,
      },
      items: expect.arrayContaining([
        expect.objectContaining({
          targetMediaId: "personalized-video",
          candidateGenerator: "multi-interest-profile",
        }),
      ]),
    })
  })

  it("combines an authorized profile nomination with semantic refill and persists hybrid execution", async () => {
    const harness = makeHarness()
    harness.retrieveProfile.mockResolvedValue(profileCandidateResult)
    harness.retrieve.mockResolvedValue(semanticCandidates(6))

    const delivery = await harness.service.deliver(
      personalizedInput("profile-seed"),
    )

    expect(delivery.items).toHaveLength(6)
    expect(harness.orchestrateHybrid).toHaveBeenCalledOnce()
    expect(harness.orchestrateHybrid).toHaveBeenCalledWith(
      expect.objectContaining({
        generatorVersion: "semantic-profile-hybrid-generators-v1",
        nominations: expect.arrayContaining([
          expect.objectContaining({
            source: expect.objectContaining({ generator: "semantic" }),
          }),
          expect.objectContaining({
            source: expect.objectContaining({
              generator: "multi-interest-profile",
            }),
          }),
        ]),
      }),
    )
    expect(
      delivery.items.some(
        (item) => item.targetMediaId === "personalized-video",
      ),
    ).toBe(true)
    expect(
      delivery.items.some((item) => item.candidateGenerator === "semantic"),
    ).toBe(true)
    expect(
      delivery.items.some(
        (item) => item.candidateGenerator === "multi-interest-profile",
      ),
    ).toBe(true)
    expect(delivery.personalization).toEqual({
      contractVersion: "anonymous-profile-personalization-v1",
      lane: "profile_challenger",
      executionMode: "hybrid_personalized",
      effectiveManifestId: "semantic-transcript-pgvector-v1",
      profileState: "session",
      projectionVersion: "multi-interest-profile-projection-v1",
      projectionGeneration: 2,
      interestCount: 1,
      sessionIntentPresent: true,
      reason: null,
    })
    expect(
      harness.tx.recommendationPersonalizationDecision.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: expect.any(String),
        lane: "profile_challenger",
        executionMode: "hybrid_personalized",
        projectionGenerationId: "projection-2",
      }),
    })
  })

  it("bounds a maximum hybrid source union before persistence while serving exactly six", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieve.mockResolvedValue(semanticCandidates(36))
    harness.retrieveProfile.mockResolvedValue({
      ...profileCandidateResult,
      projection: {
        ...profileCandidateResult.projection,
        interestCount: 5,
      },
      nominations: Array.from({ length: 40 }, (_, index) => {
        const base = profileCandidateResult.nominations[0]!
        const ordinal = index + 1
        return {
          ...base,
          nominationKey: `profile:${ordinal}:personalized-video-${ordinal}`,
          targetMediaId: `personalized-video-${ordinal}`,
          canonicalIdentity: {
            ...base.canonicalIdentity,
            videoId: `personalized-video-${ordinal}`,
            videoCoreId: `personalized-core-${ordinal}`,
            videoTitle: `Personalized video ${ordinal}`,
          },
          presentation: {
            ...base.presentation,
            videoSlug: `personalized-video-${ordinal}`,
            videoTitle: `Personalized video ${ordinal}`,
            playbackId: `mux-personalized-${ordinal}`,
          },
          source: { ...base.source, rank: ordinal },
        }
      }),
    })

    const delivery = await harness.service.deliver(
      personalizedInput("maximum-hybrid-union"),
    )

    expect(delivery.items).toHaveLength(6)
    const nominations = harness.orchestrateHybrid.mock.calls[0]?.[0]
      .nominations as ReadonlyArray<{ source: { generator: string } }>
    expect(nominations).toHaveLength(64)
    expect(
      nominations.filter((entry) => entry.source.generator === "semantic"),
    ).toHaveLength(36)
    expect(
      nominations.filter(
        (entry) => entry.source.generator === "multi-interest-profile",
      ),
    ).toHaveLength(28)
    expect(
      nominations.slice(0, 6).map((entry) => entry.source.generator),
    ).toEqual([
      "semantic",
      "multi-interest-profile",
      "semantic",
      "multi-interest-profile",
      "semantic",
      "multi-interest-profile",
    ])

    const run = harness.tx.recommendationCandidateRun.create.mock.calls[0]?.[0]
      .data as Record<string, number>
    for (const count of [
      run.nominatedCount,
      run.canonicalizedCount,
      run.deduplicatedCount,
      run.rejectedCount,
      run.scoredCount,
      run.orderedCount,
    ]) {
      expect(count).toBeLessThanOrEqual(64)
    }
    expect(run.composedCount).toBe(6)
    const evidence = harness.tx.recommendationCandidateStageEvidence.createMany
      .mock.calls[0]?.[0].data as Array<{ stage: string; ordinal: number }>
    expect(evidence.every((entry) => entry.ordinal <= 63)).toBe(true)
    expect(
      Object.values(
        evidence.reduce<Record<string, number>>((counts, entry) => {
          counts[entry.stage] = (counts[entry.stage] ?? 0) + 1
          return counts
        }, {}),
      ).every((count) => count <= 64),
    ).toBe(true)
  })

  it("uses one bounded retrieval reserve to refill six after personalized recent suppression", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieveProfile.mockResolvedValue(profileCandidateResult)
    harness.retrieve.mockResolvedValueOnce(semanticCandidates(12))
    harness.resolveRecentContext.mockResolvedValue({
      videos: semanticCandidates(6).map((item, index) => ({
        targetMediaId: item.videoId,
        reasonCodes:
          index === 0
            ? (["recent_playback_start"] as const)
            : (["repeatedly_served"] as const),
      })),
    })

    const delivery = await harness.service.deliver(
      personalizedInput("continuation-seed"),
    )

    expect(delivery.items.map((item) => item.targetMediaId)).toEqual([
      "personalized-video",
      "semantic-video-7",
      "semantic-video-8",
      "semantic-video-9",
      "semantic-video-10",
      "semantic-video-11",
    ])
    expect(delivery).toMatchObject({
      result: "served",
      requestedCount: 6,
      composedCount: 6,
      shortfallReason: null,
    })
    expect(harness.retrieve).toHaveBeenCalledOnce()
    expect(harness.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 6 }),
    )
    expect(harness.resolveRecentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionDigest: "a".repeat(64),
        profileTokenDigest: "d".repeat(64),
        allowDurableProfileLinks: false,
      }),
    )
    expect(harness.authorizeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        consentReceiptDigest: "c".repeat(64),
        profileTokenDigest: "d".repeat(64),
      }),
    )
    const evidenceRows = harness.tx.recommendationCandidateStageEvidence
      .createMany.mock.calls[0]?.[0].data as Array<{
      targetMediaId: string | null
      reasonCodes: string[]
    }>
    expect(evidenceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetMediaId: "semantic-video-1",
          reasonCodes: ["recent_playback_start"],
        }),
        expect.objectContaining({
          targetMediaId: "semantic-video-6",
          reasonCodes: ["repeatedly_served"],
        }),
      ]),
    )
    expect(
      evidenceRows.filter((row) =>
        row.reasonCodes.includes("refill_after_suppression"),
      ),
    ).toHaveLength(5)
    expect(
      evidenceRows.filter((row) =>
        row.reasonCodes.includes("bounded_reserve_refill"),
      ),
    ).toHaveLength(6)
  })

  it("keeps hybrid delivery available when bounded recent context fails", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieveProfile.mockResolvedValue({
      ...profileCandidateResult,
      projection: { ...profileCandidateResult.projection, scope: "durable" },
    })
    harness.retrieve.mockResolvedValue(semanticCandidates(6))
    harness.resolveRecentContext.mockRejectedValue(
      new Error("recent context unavailable"),
    )

    const delivery = await harness.service.deliver(
      personalizedInput("recent-context-failure"),
    )

    expect(delivery).toMatchObject({
      result: "served",
      composedCount: 6,
      shortfallReason: null,
      personalization: { executionMode: "hybrid_personalized" },
    })
    expect(harness.resolveRecentContext).toHaveBeenCalledWith(
      expect.objectContaining({ allowDurableProfileLinks: true }),
    )
    expect(
      harness.tx.recommendationCandidateRun.create.mock.calls[0]?.[0].data,
    ).toMatchObject({
      evidenceComplete: false,
      fallbackReason: "recent_context_unavailable",
    })
    expect(
      harness.tx.recommendationCandidateStageEvidence.createMany.mock
        .calls[0]?.[0].data,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceGenerator: "recent-context",
          reasonCodes: ["recent_context_unavailable"],
        }),
      ]),
    )
  })

  it("returns four available unique videos with an insufficient-catalogue reason", async () => {
    const harness = makeHarness()
    harness.retrieve.mockResolvedValue(semanticCandidates(4))

    await expect(
      harness.service.deliver(input("four-video-catalogue")),
    ).resolves.toMatchObject({
      result: "served",
      requestedCount: 6,
      composedCount: 4,
      shortfallReason: "insufficient_candidates",
      items: [
        { targetMediaId: "semantic-video-1" },
        { targetMediaId: "semantic-video-2" },
        { targetMediaId: "semantic-video-3" },
        { targetMediaId: "semantic-video-4" },
      ],
    })
  })

  it("distinguishes unavailable seed material from eligibility exhaustion", async () => {
    const missingSeed = makeHarness()
    missingSeed.retrieve.mockRejectedValue(
      new VideoNotFoundError("missing-seed"),
    )
    await expect(
      missingSeed.service.deliver(input("missing-seed")),
    ).resolves.toMatchObject({
      result: "empty",
      composedCount: 0,
      shortfallReason: "seed_material_unavailable",
    })

    const filtered = makeHarness()
    filtered.retrieve.mockResolvedValue(
      semanticCandidates(6).map((item) => ({ ...item, imageUrl: null })),
    )
    await expect(
      filtered.service.deliver(input("filtered-catalogue")),
    ).resolves.toMatchObject({
      result: "empty",
      composedCount: 0,
      shortfallReason: "eligibility_exhausted",
    })
  })

  it("deterministically relaxes recent suppression to preserve the exact-six hybrid slate", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieveProfile.mockResolvedValue(profileCandidateResult)
    harness.retrieve.mockResolvedValueOnce(semanticCandidates(6))
    harness.resolveRecentContext.mockResolvedValue({
      videos: semanticCandidates(6).map((item) => ({
        targetMediaId: item.videoId,
        reasonCodes: ["repeatedly_served"] as const,
      })),
    })

    await expect(
      harness.service.deliver(personalizedInput("reserve-exhausted")),
    ).resolves.toMatchObject({
      result: "served",
      requestedCount: 6,
      composedCount: 6,
      shortfallReason: null,
      items: [
        { targetMediaId: "personalized-video" },
        { targetMediaId: "semantic-video-1" },
        { targetMediaId: "semantic-video-2" },
        { targetMediaId: "semantic-video-3" },
        { targetMediaId: "semantic-video-4" },
        { targetMediaId: "semantic-video-5" },
      ],
      personalization: {
        executionMode: "hybrid_personalized",
        reason: null,
      },
    })
    expect(harness.retrieve).toHaveBeenCalledOnce()
  })

  it("falls back to semantic when the profile projection is unavailable", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })

    const delivery = await harness.service.deliver(
      personalizedInput("profile-fallback"),
    )

    expect(delivery.result).toBe("fallback")
    expect(delivery.items[0]).toMatchObject({
      targetMediaId: "target-video",
      candidateGenerator: "semantic",
    })
    expect(delivery.personalization).toMatchObject({
      lane: "semantic_fallback",
      executionMode: "semantic_fallback",
      reason: "profile_projection_unavailable",
    })
    expect(harness.orchestrateHybrid).not.toHaveBeenCalled()
  })

  it("treats an empty profile nomination set as source-local sparsity", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieveProfile.mockResolvedValue({
      ...profileCandidateResult,
      nominations: [],
    })

    await expect(
      harness.service.deliver(personalizedInput("profile-sparse")),
    ).resolves.toMatchObject({
      result: "fallback",
      items: [expect.objectContaining({ targetMediaId: "target-video" })],
      personalization: {
        lane: "semantic_fallback",
        executionMode: "semantic_fallback",
        reason: "profile_candidates_sparse",
      },
    })
    expect(harness.orchestrateHybrid).not.toHaveBeenCalled()
  })

  it("falls back to the semantic slate when the hybrid policy fails", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieveProfile.mockResolvedValue(profileCandidateResult)
    harness.orchestrateHybrid.mockImplementationOnce(() => {
      throw new Error("rank policy unavailable")
    })

    await expect(
      harness.service.deliver(personalizedInput("hybrid-policy-failure")),
    ).resolves.toMatchObject({
      result: "fallback",
      items: [expect.objectContaining({ targetMediaId: "target-video" })],
      personalization: {
        lane: "semantic_fallback",
        executionMode: "semantic_fallback",
        reason: "hybrid_candidate_platform_unavailable",
      },
    })
    expect(
      harness.tx.recommendationCandidateRun.create.mock.calls[0]?.[0].data,
    ).toMatchObject({
      evidenceComplete: false,
      fallbackReason: "hybrid_candidate_platform_unavailable",
    })
  })

  it("keeps recent refill hybrid and retains profile signal instead of falling back", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieveProfile.mockResolvedValue(profileCandidateResult)
    harness.retrieve.mockResolvedValue(semanticCandidates(6))
    harness.resolveRecentContext.mockResolvedValue({
      videos: [
        ...semanticCandidates(6).map((item) => ({
          targetMediaId: item.videoId,
          reasonCodes: ["repeatedly_served"] as const,
        })),
        {
          targetMediaId: "personalized-video",
          reasonCodes: ["recent_playback_start"],
        },
      ],
    })

    await expect(
      harness.service.deliver(personalizedInput("hybrid-empty")),
    ).resolves.toMatchObject({
      result: "served",
      requestedCount: 6,
      composedCount: 6,
      shortfallReason: null,
      items: [
        expect.objectContaining({ targetMediaId: "personalized-video" }),
        expect.objectContaining({ targetMediaId: "semantic-video-1" }),
        expect.objectContaining({ targetMediaId: "semantic-video-2" }),
        expect.objectContaining({ targetMediaId: "semantic-video-3" }),
        expect.objectContaining({ targetMediaId: "semantic-video-4" }),
        expect.objectContaining({ targetMediaId: "semantic-video-5" }),
      ],
      personalization: {
        lane: "profile_challenger",
        executionMode: "hybrid_personalized",
        reason: null,
      },
    })
    expect(
      harness.tx.recommendationCandidateRun.create.mock.calls[0]?.[0].data,
    ).toMatchObject({
      composedCount: 6,
      shortfallReason: null,
    })
  })

  it("never reads profile state for an unassigned semantic control request", async () => {
    const harness = makeHarness()

    await expect(
      harness.service.deliver(input("semantic-control")),
    ).resolves.toMatchObject({
      result: "served",
      personalization: {
        lane: "semantic_control",
        executionMode: "semantic_contextual",
      },
    })

    expect(harness.retrieveProfile).not.toHaveBeenCalled()
    expect(harness.orchestrateHybrid).not.toHaveBeenCalled()
  })

  it("keeps Essential-only humans eligible for semantic recommendations without reading profile state", async () => {
    const harness = makeHarness()

    await expect(
      harness.service.deliver(input("essential-only")),
    ).resolves.toMatchObject({
      result: "served",
      personalization: {
        lane: "semantic_control",
        executionMode: "semantic_contextual",
      },
    })

    expect(harness.authorizeProfile).not.toHaveBeenCalled()
    expect(harness.retrieveProfile).not.toHaveBeenCalled()
    expect(harness.assignExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        eligibleHuman: true,
        profileTokenDigest: null,
      }),
    )
  })

  it("starts the assigned profile lane while semantic retrieval is still running", async () => {
    const harness = makeHarness()
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    let finishSemantic: ((value: (typeof candidate)[]) => void) | undefined
    harness.retrieve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSemantic = resolve
        }),
    )
    harness.retrieveProfile.mockResolvedValue(profileCandidateResult)

    const pending = harness.service.deliver(
      personalizedInput("parallel-profile-seed"),
    )
    await vi.waitFor(() =>
      expect(harness.retrieveProfile).toHaveBeenCalledOnce(),
    )
    expect(finishSemantic).toBeTypeOf("function")
    finishSemantic?.([candidate])

    await expect(pending).resolves.toMatchObject({
      result: "served",
      personalization: { lane: "profile_challenger" },
      items: expect.arrayContaining([
        expect.objectContaining({ targetMediaId: "personalized-video" }),
        expect.objectContaining({ targetMediaId: "target-video" }),
      ]),
    })
  })

  it("preserves semantic and profile fallback reasons in independent trace channels", async () => {
    const harness = makeHarness()
    await harness.service.deliver(input("dual-failure-seed"))
    harness.assignExperiment.mockResolvedValue({
      assignment: {
        assignmentId: "assignment-profile",
        experimentId: "anonymous-profile-pilot-v1",
        experimentVersion: "anonymous-profile-pilot-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
        assignmentProbability: 0.1,
        configurationDigest: "f".repeat(64),
      },
      bypassReason: null,
    })
    harness.retrieve.mockRejectedValueOnce(new Error("semantic unavailable"))
    harness.retrieveProfile.mockResolvedValueOnce(null)

    const delivery = await harness.service.deliver(
      personalizedInput("dual-failure-seed", "b"),
    )

    expect(delivery).toMatchObject({
      result: "fallback",
      reason: "candidate_pool_fallback",
      personalization: {
        lane: "semantic_fallback",
        reason: "profile_projection_unavailable",
      },
    })
    expect(
      harness.tx.recommendationCandidateRun.create.mock.calls[1]?.[0].data,
    ).toMatchObject({ fallbackReason: "candidate_pool_fallback" })
    expect(
      harness.tx.recommendationPersonalizationDecision.create.mock.calls[1]?.[0]
        .data,
    ).toMatchObject({ reasonCode: "profile_projection_unavailable" })
  })
  it("signs A/A attribution without changing semantic item order and bypasses assignment failure", async () => {
    const firstHarness = makeHarness()
    firstHarness.assignExperiment.mockResolvedValueOnce({
      assignment: {
        assignmentId: "assignment-1",
        experimentId: "semantic-aa-v1",
        experimentVersion: "semantic-aa-v1",
        experimentGeneration: 1,
        arm: "challenger",
        effectiveManifestId: "semantic-experiment-aa-v1",
        assignmentProbability: 0.5,
        configurationDigest: "b".repeat(64),
      },
      bypassReason: null,
    })
    const assigned = await firstHarness.service.deliver(input("aa-seed"))
    expect(assigned.items.map((item) => item.targetMediaId)).toEqual([
      "target-video",
    ])
    expect(firstHarness.signDeliveryCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "assignment-1",
        experimentArm: "challenger",
        effectiveManifestId: "semantic-experiment-aa-v1",
      }),
    )

    const failedHarness = makeHarness()
    failedHarness.assignExperiment.mockRejectedValueOnce(
      new Error("assignment store unavailable"),
    )
    const bypassed = await failedHarness.service.deliver(input("aa-fallback"))
    expect(bypassed.result).toBe("served")
    expect(bypassed.items.map((item) => item.targetMediaId)).toEqual([
      "target-video",
    ])
    expect(failedHarness.signDeliveryCapability).toHaveBeenCalledWith(
      expect.not.objectContaining({ assignmentId: expect.anything() }),
    )
  })

  it("excludes a request classified as machine traffic from assignment", async () => {
    const harness = makeHarness()

    await harness.service.deliver({
      ...input("machine-seed"),
      eligibleHuman: false,
    })

    expect(harness.assignExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ eligibleHuman: false }),
    )
  })
})
