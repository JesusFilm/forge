import { afterEach, describe, expect, it, vi } from "vitest"
import { VideoNotFoundError } from "@/services/scene-recommendations.service"
import { runSemanticCandidatePlatform } from "./orchestration"
import { adaptSemanticCandidates } from "./candidate"
import {
  input,
  makeHarness,
  personalizedInput,
  semanticCandidates,
} from "./delivery.service.test-helpers"

afterEach(() => vi.useRealTimers())

describe("content-only recommendation delivery", () => {
  it.each([false, true])(
    "ignores viewer credentials with legacy comparison enabled=%s",
    async (profileComparison) => {
      const h = makeHarness({ profileComparison })
      h.retrieve.mockResolvedValue(semanticCandidates(8))
      const response = await h.service.deliver(
        personalizedInput(`retired-${profileComparison}`),
      )
      expect(response.result).toBe("served")
      expect(response.items.map((item) => item.targetMediaId)).toEqual(
        semanticCandidates(6).map((item) => item.videoId),
      )
      expect(response.personalization).toMatchObject({
        lane: "semantic_control",
        executionMode: "semantic_contextual",
        profileState: null,
      })
      for (const operation of [
        h.authorizeProfile,
        h.retrieveProfile,
        h.resolveRecentContext,
        h.loadViewingModeAffinity,
        h.assignExperiment,
        h.assignProfileExperiment,
        h.orchestrateHybrid,
      ]) {
        expect(operation).not.toHaveBeenCalled()
      }
      expect(
        h.tx.recommendationPersonalizationDecision.create,
      ).not.toHaveBeenCalled()
    },
  )

  it("never queries old co-watch authority, even with compatible credentials", async () => {
    const resolveOwnerAuthority = vi.fn(() => {
      throw new Error("retired authority queried")
    })
    const resolveStudyAuthority = vi.fn(() => {
      throw new Error("retired study queried")
    })
    const h = makeHarness({
      owner: { resolveOwnerAuthority },
      study: { resolveStudyAuthority },
    })
    expect(
      (await h.service.deliver(personalizedInput("retired-owner"))).result,
    ).toBe("served")
    expect(resolveOwnerAuthority).not.toHaveBeenCalled()
    expect(resolveStudyAuthority).not.toHaveBeenCalled()
  })

  it.each(["exception", "eligibility-parity", "ranker-parity"])(
    "preserves deterministic semantic fallback after %s failure",
    async (failure) => {
      const h = makeHarness()
      h.retrieve.mockResolvedValue(semanticCandidates(8))
      h.orchestrate.mockImplementation((args) => {
        if (failure === "exception") throw new Error("platform unavailable")
        const result = runSemanticCandidatePlatform(args)
        return {
          ...result,
          parity: {
            ...result.parity,
            ...(failure === "eligibility-parity"
              ? { candidateEligibility: "failed" as const }
              : { ranker: "failed" as const }),
          },
        }
      })
      const response = await h.service.deliver(input(`fallback-${failure}`))
      expect(response.result).toBe("fallback")
      expect(response.items.map((item) => item.targetMediaId)).toEqual(
        semanticCandidates(6).map((item) => item.videoId),
      )
      expect(h.resolveRecentContext).not.toHaveBeenCalled()
    },
  )

  it("uses metadata reserves when the current video has no semantic embedding", async () => {
    const h = makeHarness({ curatedFallback: true })
    h.retrieve.mockRejectedValue(new VideoNotFoundError("seed"))
    const candidates = semanticCandidates(7)
    h.retrieveCuratedFallback.mockResolvedValue(
      adaptSemanticCandidates(candidates, {
        surface: "watch-below-player-v1",
        purpose: "watch",
        locale: "en",
        audioLanguageSlug: "english",
      }).nominations.map((nomination) => ({
        ...nomination,
        source: { ...nomination.source, generator: "curated" },
      })),
    )
    const response = await h.service.deliver(input("metadata-reserve"))
    expect(response.result).toBe("fallback")
    expect(response.items).toHaveLength(6)
    expect(
      response.items.every((item) => item.candidateGenerator === "curated"),
    ).toBe(true)
    expect(h.retrieveCuratedFallback).toHaveBeenCalledWith(
      expect.objectContaining({ audioLanguageSlug: "english" }),
    )
  })

  it("reports real catalog shortfall without inventing profile candidates", async () => {
    const h = makeHarness()
    h.retrieve.mockResolvedValue(semanticCandidates(4))
    const response = await h.service.deliver(personalizedInput("sparse"))
    expect(response.items).toHaveLength(4)
    expect(response).toMatchObject({ requestedCount: 6, composedCount: 4 })
    expect(response.shortfallReason).not.toBeNull()
  })

  it("keeps issuance failure private and releases admission", async () => {
    const h = makeHarness()
    h.tx.recommendationRequest.create.mockRejectedValue(
      new Error("database unavailable"),
    )
    const response = await h.service.deliver(input("failed-persist"))
    expect(response).toMatchObject({ result: "unavailable", items: [] })
    expect(h.release).toHaveBeenCalledOnce()
  })
})
