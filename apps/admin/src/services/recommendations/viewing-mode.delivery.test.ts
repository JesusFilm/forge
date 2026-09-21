import { describe, expect, it } from "vitest"
import {
  input,
  makeHarness,
  semanticCandidates,
} from "./delivery.service.test-helpers"

describe("viewing mode delivery", () => {
  it("does not issue a prepared mode-ranked slate after its profile is reset", async () => {
    const h = makeHarness()
    h.loadViewingModeAffinity.mockResolvedValue({
      authority: { profileId: "revoked-profile", privacyGeneration: 1 },
      version: "viewing-mode-affinity-v1",
      soundOffPreference: 1,
      confidence: 1,
      qualifiedVideos: 3,
      candidates: [
        {
          mediaId: "target-video",
          viewers: 25,
          qualifiedViewers: 24,
          affinity: 0.8,
        },
      ],
    })
    const result = await h.service.deliver({
      ...input(),
      profileTokenDigest: "b".repeat(64),
      consentReceiptDigest: "c".repeat(64),
    })
    expect(result.result).toBe("unavailable")
    expect(result.items).toEqual([])
    expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
  })
  it("uses a mode preference even before topic interests exist and records truthful provenance", async () => {
    const h = makeHarness()
    h.tx.$queryRaw.mockResolvedValue([{ id: "mode-profile" }])
    const candidates = semanticCandidates(8)
    candidates[1] = { ...candidates[1]!, similarity: 0.899 }
    h.retrieve.mockResolvedValue(candidates)
    h.loadViewingModeAffinity.mockResolvedValue({
      authority: { profileId: "mode-profile", privacyGeneration: 1 },
      version: "viewing-mode-affinity-v1",
      soundOffPreference: 1,
      confidence: 1,
      qualifiedVideos: 3,
      candidates: [
        {
          mediaId: candidates[1]!.videoId,
          viewers: 25,
          qualifiedViewers: 24,
          affinity: 0.8,
        },
      ],
    })
    const result = await h.service.deliver({
      ...input(),
      profileTokenDigest: "b".repeat(64),
      consentReceiptDigest: "c".repeat(64),
    })
    expect(result.items[0]?.targetMediaId).toBe(candidates[1]!.videoId)
    expect(result.personalization).toMatchObject({
      lane: "profile_challenger",
      executionMode: "viewing_mode_personalized",
      interestCount: 0,
    })
    const request = [...h.requests.values()][0] as {
      items: { create: Array<{ candidateProvenance: unknown }> }
    }
    expect(request.items.create[0]?.candidateProvenance).toMatchObject({
      viewingMode: { qualifiedVideos: 3, candidate: { viewers: 25 } },
    })
  })

  it("preserves contextual results when mode retrieval fails and never reads a revoked profile", async () => {
    const h = makeHarness()
    h.loadViewingModeAffinity.mockRejectedValue(new Error("mode unavailable"))
    const result = await h.service.deliver({
      ...input(),
      profileTokenDigest: "b".repeat(64),
      consentReceiptDigest: "c".repeat(64),
    })
    expect(result.items).toHaveLength(1)
    expect(result.personalization?.executionMode).toBe("semantic_contextual")
    h.loadViewingModeAffinity.mockClear()
    h.authorizeProfile.mockResolvedValue(false)
    await h.service.deliver({
      ...input("next-seed"),
      profileTokenDigest: "b".repeat(64),
      consentReceiptDigest: "c".repeat(64),
    })
    expect(h.loadViewingModeAffinity).not.toHaveBeenCalled()
  })
})
