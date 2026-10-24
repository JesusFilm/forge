import { describe, expect, it, vi } from "vitest"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
} from "./delivery.service.test-helpers"
import { userDeliveryHarness } from "./user-delivery.service.test-helpers"
import {
  recommendationTraffic,
  observeRecommendationTraffic,
  CONTEXTUAL_RECOMMENDATION_CAPABILITY,
} from "./traffic"

describe("origin recommendation traffic isolation", () => {
  it.each([
    "declared_crawler",
    "speculative_prefetch",
    "speculative_prerender",
  ])(
    "excludes %s before admission, authorization and persistence on both surfaces",
    async (trafficCategory) => {
      const seeded = makeHarness({ curatedFallback: true })
      seeded.retrieveCuratedFallback.mockResolvedValue(
        Array.from({ length: 6 }, (_, index) => {
          const base = profileCandidateResult.nominations[0]
          return {
            ...base,
            nominationKey: `curated-${index}`,
            targetMediaId: `public-video-${index}`,
            presentation: {
              ...base.presentation,
              videoSlug: `public-video-${index}`,
            },
          }
        }),
      )
      const forYou = userDeliveryHarness(6)
      for (const harness of [seeded, forYou]) {
        const response = await harness.service.deliver({
          ...personalizedInput(),
          trafficCategory,
          sessionDigest: "unused",
        })
        expect(response.requestId).toBeNull()
        expect(response.expiresAt).toBeNull()
        expect(harness.acquire).not.toHaveBeenCalled()
        expect(harness.getServingState).not.toHaveBeenCalled()
        expect(harness.authorizeProfile).not.toHaveBeenCalled()
        expect(harness.retrieveProfile).not.toHaveBeenCalled()
        expect(harness.signDeliveryCapability).not.toHaveBeenCalled()
        expect(harness.requests.size).toBe(0)
        if (trafficCategory.startsWith("speculative"))
          expect(response.items).toEqual([])
        else {
          expect(response.items.map((item) => item.position)).toEqual([
            0, 1, 2, 3, 4, 5,
          ])
          expect(
            response.items.every(
              (item) =>
                item.capability === CONTEXTUAL_RECOMMENDATION_CAPABILITY,
            ),
          ).toBe(true)
          expect(
            response.items.every((item) =>
              item.canonicalHref.startsWith("/watch/"),
            ),
          ).toBe(true)
        }
      }
    },
  )

  it("does not let ordinary classification override legacy exclusion", () => {
    expect(
      recommendationTraffic({
        ...personalizedInput(),
        trafficCategory: "ordinary_browser",
        eligibleHuman: false,
      }),
    ).toMatchObject({ disposition: "contextual", reason: "legacy_ineligible" })
    expect(recommendationTraffic(personalizedInput()).disposition).toBe(
      "measured",
    )
  })

  it.each([1, 5])(
    "keeps a partial %i-card contextual slate parseable",
    async (count) => {
      const h = makeHarness({ curatedFallback: true })
      h.retrieveCuratedFallback.mockResolvedValue(
        Array.from({ length: count }, (_, index) => ({
          ...profileCandidateResult.nominations[0],
          nominationKey: `curated-${index}`,
          targetMediaId: `public-video-${index}`,
        })),
      )
      const response = await h.service.deliver({
        ...personalizedInput(),
        trafficCategory: "declared_crawler",
      })
      expect(response).toMatchObject({
        result: "fallback",
        requestId: null,
        requestedCount: 6,
        composedCount: count,
        shortfallReason: "insufficient_candidates",
      })
      expect(response.items.map((item) => item.position)).toEqual(
        Array.from({ length: count }, (_, index) => index),
      )
      expect(h.requests.size).toBe(0)
    },
  )

  it("rejects explicit invalid categories and fleet provenance before retrieval", async () => {
    const h = makeHarness({ curatedFallback: true })
    await expect(
      h.service.deliver({
        ...personalizedInput(),
        trafficCategory: "injected",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" })
    await expect(
      h.service.deliver({
        ...personalizedInput(),
        caller: {
          ...personalizedInput().caller!,
          fleet: true,
          recommendationViewerVerified: true,
        },
        trafficCategory: "declared_crawler",
      }),
    ).rejects.toMatchObject({ code: "authentication_required" })
    expect(h.retrieveCuratedFallback).not.toHaveBeenCalled()
  })

  it("keeps fallback failures untracked and lets ordinary navigation persist afterwards", async () => {
    const h = makeHarness({ curatedFallback: true })
    h.retrieveCuratedFallback.mockRejectedValue(new Error("unavailable"))
    expect(
      await h.service.deliver({
        ...personalizedInput(),
        trafficCategory: "declared_crawler",
      }),
    ).toMatchObject({
      requestId: null,
      items: [],
      reason: "contextual_unavailable",
    })
    expect(h.requests.size).toBe(0)
    expect(
      await h.service.deliver({
        ...personalizedInput(),
        trafficCategory: "ordinary_browser",
      }),
    ).toMatchObject({ result: "served", requestId: expect.any(String) })
  })

  it("emits only bounded metric fields and tolerates logging failure", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const traffic = recommendationTraffic({
      ...personalizedInput(),
      trafficCategory: "declared_crawler",
    })
    observeRecommendationTraffic("seeded", traffic, "persistence_avoided")
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "recommendation.traffic",
      schemaVersion: 1,
      classifierVersion: "origin-traffic-v1",
      surface: "seeded",
      category: "declared_crawler",
      disposition: "contextual",
      reason: "origin_classification",
      phase: "persistence_avoided",
      count: 1,
    })
    log.mockImplementation(() => {
      throw new Error("log unavailable")
    })
    expect(() =>
      observeRecommendationTraffic("seeded", traffic, "attempted"),
    ).not.toThrow()
    log.mockRestore()
  })
})
