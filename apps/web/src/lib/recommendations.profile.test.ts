import { afterEach, describe, expect, it, vi } from "vitest"

const { mutateMock, queryMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock("@/lib/admin-client", () => ({
  default: { mutate: mutateMock, query: queryMock },
}))

import {
  getSemanticRecommendationDelivery,
  getRecommendationProfileStatus,
  transitionRecommendationProfile,
} from "./recommendations"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  mutateMock.mockReset()
  queryMock.mockReset()
})

describe("semantic recommendation delivery timeout", () => {
  it("bounds semantic delivery to 3.5 seconds without a recovery request", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    const semanticDelivery = {
      contractVersion: "semantic-recommendation-v1",
      surfaceVersion: "watch-below-player-v1",
      strategyVersion: "semantic-transcript-pgvector-v1",
      classifierVersion: "legacy-position-v0",
      requestId: "request-1",
      result: "served",
      reason: null,
      expiresAt: null,
      requestedCount: 6,
      composedCount: 0,
      shortfallReason: null,
      personalization: null,
      items: [],
    }
    queryMock.mockResolvedValueOnce({
      data: { semanticRecommendationDelivery: semanticDelivery },
    })

    await expect(getSemanticRecommendationDelivery({} as never)).resolves.toBe(
      semanticDelivery,
    )
    expect(queryMock).toHaveBeenCalledOnce()

    expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(3_500)
  })

  it("does not retry an explicit Admin GraphQL error", async () => {
    queryMock.mockResolvedValueOnce({
      data: null,
      error: new Error("semantic resolver rejected the request"),
    })

    await expect(
      getSemanticRecommendationDelivery({} as never),
    ).rejects.toMatchObject({ code: "delivery_unavailable" })
    expect(queryMock).toHaveBeenCalledOnce()
  })
})

describe("recommendation profile control timeout", () => {
  it("allows profile reads and transitions three seconds upstream", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    mutateMock
      .mockResolvedValueOnce({
        data: { recommendationProfileStatus: { state: "session_only" } },
      })
      .mockResolvedValueOnce({
        data: { transitionRecommendationProfile: { state: "active" } },
      })

    await getRecommendationProfileStatus({} as never)
    await transitionRecommendationProfile({} as never)

    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 3_000)
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 3_000)
  })
})
