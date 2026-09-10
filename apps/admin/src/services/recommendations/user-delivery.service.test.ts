import { describe, expect, it, vi } from "vitest"
import {
  UserRecommendationDeliveryService,
  composeUserRecommendations,
} from "./user-delivery.service"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
} from "./delivery.service.test-helpers"
import type { PrismaClient } from "@prisma/client"

function video(index: number) {
  return {
    videoId: `video-${index}`,
    videoCoreId: `core-${String(index).padStart(3, "0")}`,
    videoTitle: `Video ${index}`,
    videoSlug: `video-${index}`,
    imageUrl: "https://image.test/poster.jpg",
    description: "A video",
    playbackId: "mux",
    generator: "curated" as const,
    poolVersion: "v1",
    poolKey: "start",
  }
}
function harness(primaryCount: number) {
  const h = makeHarness()
  const nominations = Array.from({ length: primaryCount }, (_, index) => {
    const v = video(index),
      base = profileCandidateResult.nominations[0]
    return {
      ...base,
      targetMediaId: v.videoId,
      canonicalIdentity: {
        ...base.canonicalIdentity,
        videoId: v.videoId,
        videoCoreId: v.videoCoreId,
        videoTitle: v.videoTitle,
      },
      presentation: { ...base.presentation, ...v },
    }
  })
  h.retrieveProfile.mockResolvedValue(
    primaryCount ? { ...profileCandidateResult, nominations } : null,
  )
  const curated = vi.fn(async () => ({
    version: "v1",
    items: Array.from({ length: 30 }, (_, index) => video(index + 10)),
  }))
  const history = vi.fn(
    async () => [] as { mediaId: string; completed: boolean }[],
  )
  const service = new UserRecommendationDeliveryService({
    prisma: h.prisma as unknown as PrismaClient,
    enabled: true,
    admission: { acquire: h.acquire, release: h.release },
    getServingState: h.getServingState,
    tokenService: {
      activeKid: "kid",
      signDeliveryCapability: h.signDeliveryCapability,
    },
    retrieve: h.retrieve,
    recheckCached: h.recheckCached,
    authorizeProfile: h.authorizeProfile,
    retrieveProfile: h.retrieveProfile,
    curated,
    history,
  })
  return { ...h, curated, history, service }
}
describe("source-free recommendations", () => {
  it("returns six profile videos without retrieving fallback or seeded candidates", async () => {
    const h = harness(6),
      response = await h.service.deliver(personalizedInput())
    expect(response).toMatchObject({
      result: "served",
      profileCount: 6,
      curatedCount: 0,
    })
    expect(h.curated).not.toHaveBeenCalled()
    expect(h.retrieve).not.toHaveBeenCalled()
    expect(h.retrieveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ seedMediaId: null }),
    )
    expect(h.tx.recommendationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: "user",
          seedMediaId: null,
          state: "ISSUED",
        }),
      }),
    )
    expect(response.items[0].canonicalHref).toBe("/watch/video-0.html")
    expect(response.items[0]).not.toHaveProperty("sceneIndex")
    expect(response.items[0]).not.toHaveProperty("embeddingText")
    expect(response.items[0]).not.toHaveProperty("videoCoreId")
  })
  it.each([0, 1, 4])(
    "fills exactly the missing positions after %i profile candidates",
    async (count) => {
      const h = harness(count),
        response = await h.service.deliver(personalizedInput())
      expect(response).toMatchObject({
        result: "served",
        profileCount: count,
        curatedCount: 6 - count,
      })
      expect(response.items).toHaveLength(6)
      expect(
        response.items
          .slice(0, count)
          .every((item) => item.generator === "multi-interest-profile"),
      ).toBe(true)
    },
  )
  it("removes completed/duplicate results before deciding how many fallback cards to append", async () => {
    const h = harness(6)
    h.history.mockResolvedValue([
      { mediaId: "video-0", completed: true },
      { mediaId: "video-1", completed: false },
    ])
    const response = await h.service.deliver(personalizedInput())
    expect(response).toMatchObject({ profileCount: 5, curatedCount: 1 })
    expect(response.items.map((item) => item.videoId)).toEqual([
      "video-2",
      "video-3",
      "video-4",
      "video-5",
      "video-1",
      "video-10",
    ])
    expect(
      composeUserRecommendations(
        [video(1)],
        [
          video(1),
          { ...video(2), videoCoreId: video(1).videoCoreId + "AD" },
          video(3),
        ],
        [],
        6,
      ),
    ).toEqual([video(1), video(3)])
  })
  it("suppresses alternate editions of a recently completed video", () => {
    expect(
      composeUserRecommendations(
        [],
        [video(1), video(2)],
        [
          {
            mediaId: "another-edition",
            videoCoreId: video(1).videoCoreId + "AD",
            completed: true,
          },
        ],
        6,
      ),
    ).toEqual([video(2)])
  })
  it("uses starters while the only profile signal is a click", async () => {
    const h = harness(6)
    h.retrieveProfile.mockResolvedValue({
      ...profileCandidateResult,
      projection: {
        ...profileCandidateResult.projection,
        qualifiedInterestCount: 0,
      },
    })
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      profileCount: 0,
      curatedCount: 6,
      cohort: "cold_start",
    })
  })
  it("continues with curated results after a profile retrieval failure", async () => {
    const h = harness(4)
    h.retrieveProfile.mockRejectedValue(new Error("timeout"))
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      result: "served",
      curatedCount: 6,
    })
  })
  it("does not read profile/history without valid authority", async () => {
    const h = harness(6)
    h.authorizeProfile.mockResolvedValue(false)
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      result: "served",
      curatedCount: 6,
    })
    expect(h.retrieveProfile).not.toHaveBeenCalled()
    expect(h.history).not.toHaveBeenCalled()
  })
  it("reports insufficient coverage without publishing an undersized or wrong-language slate", async () => {
    const h = harness(0)
    h.curated.mockResolvedValue({ version: "v1", items: [video(1)] })
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      result: "unavailable",
      reason: "coverage_unavailable",
      items: [],
    })
    expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
  })
  it("never exposes capabilities when persistence fails", async () => {
    const h = harness(6)
    h.tx.recommendationRequest.create.mockRejectedValue(new Error("db down"))
    expect(await h.service.deliver(personalizedInput())).toMatchObject({
      result: "unavailable",
      items: [],
    })
    expect(h.release).toHaveBeenCalledOnce()
  })
  it.each([0, 21, 1.5])("rejects count %i before admission", async (count) => {
    const h = harness(0)
    expect(
      await h.service.deliver({ ...personalizedInput(), count }),
    ).toMatchObject({ reason: "invalid_input" })
    expect(h.acquire).not.toHaveBeenCalled()
  })
})
