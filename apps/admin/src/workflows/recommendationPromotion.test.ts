import { describe, expect, it, vi } from "vitest"

const runRecommendationPromotionJob = vi.hoisted(() => vi.fn())
const markRecommendationPromotionRuntimeStarted = vi.hoisted(() => vi.fn())
vi.mock("@/services/recommendations/promotion/job", () => ({
  runRecommendationPromotionJob,
  markRecommendationPromotionRuntimeStarted,
}))
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "runtime-1" }),
}))

describe("recommendation promotion durable workflow", () => {
  it("dispatches the fenced business-ledger run through the workflow entrypoint", async () => {
    runRecommendationPromotionJob.mockResolvedValue({
      status: "activated",
      generation: 2,
    })
    const { runRecommendationPromotion } =
      await import("./recommendationPromotion")
    await expect(
      runRecommendationPromotion({
        runId: "run-1",
        expectedGeneration: 1,
        ledgerRunId: "ledger-1",
      }),
    ).resolves.toEqual({ status: "activated", generation: 2 })
    expect(markRecommendationPromotionRuntimeStarted).toHaveBeenCalledWith(
      {
        runId: "run-1",
        expectedGeneration: 1,
        ledgerRunId: "ledger-1",
      },
      "runtime-1",
    )
    expect(markRecommendationPromotionRuntimeStarted).toHaveBeenCalledBefore(
      runRecommendationPromotionJob,
    )
  })
})
