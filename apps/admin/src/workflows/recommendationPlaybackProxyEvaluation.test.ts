import { describe, expect, it, vi } from "vitest"

const evaluatePlaybackProxyReadiness = vi.hoisted(() => vi.fn())
vi.mock("@/db/client", () => ({ prisma: { private: "db-client" } }))
vi.mock("@/services/recommendations/playback-proxy-evaluation.service", () => ({
  evaluatePlaybackProxyReadiness,
}))

describe("recommendation playback proxy evaluation workflow", () => {
  it("runs a bounded offline evaluation window", async () => {
    evaluatePlaybackProxyReadiness.mockResolvedValue({
      status: "published",
      evaluation: {
        id: "evaluation-1",
        revision: 2,
        state: "inconclusive",
      },
    })
    const { runRecommendationPlaybackProxyEvaluation } =
      await import("./recommendationPlaybackProxyEvaluation")

    await expect(
      runRecommendationPlaybackProxyEvaluation({
        windowStart: "2026-08-26T00:00:00.000Z",
        windowEnd: "2026-09-02T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      status: "published",
      evaluationId: "evaluation-1",
      revision: 2,
      state: "inconclusive",
    })
    expect(evaluatePlaybackProxyReadiness).toHaveBeenCalledWith(
      { private: "db-client" },
      {
        windowStart: new Date("2026-08-26T00:00:00.000Z"),
        windowEnd: new Date("2026-09-02T00:00:00.000Z"),
      },
    )
  })
})
