import { describe, expect, it } from "vitest"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "../delivery.service.test-helpers"
import { HYBRID_PERSONALIZED_MANIFEST_ID } from "../promotion/manifest"

function harness(manifestId: string, arm: "control" | "challenger") {
  const h = makeHarness({ profileComparison: true })
  h.retrieve.mockResolvedValue(semanticCandidates(6))
  h.retrieveProfile.mockResolvedValue({
    ...profileCandidateResult,
    projection: { ...profileCandidateResult.projection, scope: "durable" },
  })
  h.assignProfileExperiment.mockResolvedValue({
    assignment: {
      assignmentId: "comparison-1",
      experimentId: "profile-comparison-v1",
      experimentVersion: "profile-comparison-v1",
      experimentGeneration: 1,
      arm,
      effectiveManifestId: manifestId,
      assignmentProbability: 0.5,
      configurationDigest: "c".repeat(64),
    },
    bypassReason: null,
  })
  h.tx.$queryRaw.mockResolvedValue([{ id: "comparison-1" }])
  h.resolveRecentContext.mockResolvedValue({
    videos: [
      {
        targetMediaId: "semantic-video-1",
        reasonCodes: ["recent_playback_start"],
      },
    ],
  })
  return h
}

describe("profile usefulness delivery routing", () => {
  it.each([
    ["semantic-transcript-pgvector-v1", "control"],
    ["semantic-experiment-aa-v1", "challenger"],
  ] as const)(
    "bypasses profile ranking for %s while retaining the same history policy",
    async (manifestId, arm) => {
      const h = harness(manifestId, arm)
      const delivery = await h.service.deliver(
        personalizedInput(`comparison-${arm}`),
      )
      expect(delivery.result).toBe("served")
      expect(delivery.personalization).toMatchObject({
        executionMode: "semantic_contextual",
        effectiveManifestId: manifestId,
      })
      expect(h.assignProfileExperiment).toHaveBeenCalledWith(
        expect.objectContaining({ eligibleForEnrollment: true }),
      )
      expect(h.orchestrateHybrid).not.toHaveBeenCalled()
      expect(h.loadViewingModeAffinity).not.toHaveBeenCalled()
      expect(h.orchestrate).toHaveBeenCalledWith(
        expect.objectContaining({
          composition: expect.objectContaining({
            recentVideos: [
              {
                targetMediaId: "semantic-video-1",
                reasonCodes: ["recent_playback_start"],
              },
            ],
          }),
        }),
      )
      expect(h.tx.recommendationRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            experimentAssignmentId: "comparison-1",
          }),
        }),
      )
    },
  )

  it("routes the exact hybrid challenger with no mode-ranking contamination", async () => {
    const h = harness(HYBRID_PERSONALIZED_MANIFEST_ID, "challenger")
    const delivery = await h.service.deliver(
      personalizedInput("comparison-hybrid"),
    )
    expect(delivery.personalization).toMatchObject({
      executionMode: "hybrid_personalized",
      effectiveManifestId: HYBRID_PERSONALIZED_MANIFEST_ID,
    })
    expect(h.orchestrateHybrid).toHaveBeenCalledOnce()
    expect(h.resolveRecentContext).toHaveBeenCalledOnce()
    expect(h.loadViewingModeAffinity).not.toHaveBeenCalled()
  })

  it("keeps a previously assigned viewer in their arm when their projection is unavailable", async () => {
    const h = harness("semantic-transcript-pgvector-v1", "control")
    h.retrieveProfile.mockResolvedValue(null)
    const delivery = await h.service.deliver(
      personalizedInput("comparison-cold"),
    )
    expect(h.assignProfileExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ eligibleForEnrollment: false }),
    )
    expect(delivery.personalization?.executionMode).toBe("semantic_contextual")
    expect(h.tx.recommendationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          experimentAssignmentId: "comparison-1",
        }),
      }),
    )
  })

  it("fences issuance after privacy reset while preserving the enrolled denominator", async () => {
    const h = harness("semantic-transcript-pgvector-v1", "control")
    h.tx.$queryRaw.mockResolvedValue([])
    expect(
      await h.service.deliver(personalizedInput("comparison-reset")),
    ).toMatchObject({ result: "unavailable" })
    expect(h.assignProfileExperiment).toHaveBeenCalledOnce()
    expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
  })
})
