import { afterEach, describe, expect, it, vi } from "vitest"

const { mutateMock } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
}))

vi.mock("@/lib/admin-client", () => ({
  default: { mutate: mutateMock },
}))

import {
  getRecommendationProfileStatus,
  transitionRecommendationProfile,
} from "./recommendations"

afterEach(() => {
  vi.restoreAllMocks()
  mutateMock.mockReset()
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
