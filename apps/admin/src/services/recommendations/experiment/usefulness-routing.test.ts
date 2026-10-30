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
  it.each(["control", "challenger"] as const)(
    "ignores an old %s assignment and serves content-only recommendations",
    async (arm) => {
      const h = harness(HYBRID_PERSONALIZED_MANIFEST_ID, arm)
      const receipt = await h.service.deliver(
        personalizedInput(`retired-${arm}`),
      )
      expect(receipt.result).toBe("served")
      expect(receipt.personalization?.lane).toBe("semantic_control")
      expect(h.assignProfileExperiment).not.toHaveBeenCalled()
      expect(h.retrieveProfile).not.toHaveBeenCalled()
      expect(h.resolveRecentContext).not.toHaveBeenCalled()
    },
  )
})
