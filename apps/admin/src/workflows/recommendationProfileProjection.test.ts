import { describe, expect, it, vi } from "vitest"

const runRecommendationProfileProjectionJob = vi.hoisted(() => vi.fn())
const markRecommendationProfileProjectionRuntimeStarted = vi.hoisted(() =>
  vi.fn(),
)
vi.mock("@/services/recommendations/profiles/job", () => ({
  runRecommendationProfileProjectionJob,
  markRecommendationProfileProjectionRuntimeStarted,
}))
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "runtime-1" }),
}))

describe("recommendation profile projection durable workflow", () => {
  it("executes the generation-fenced private projection run", async () => {
    runRecommendationProfileProjectionJob.mockResolvedValue({
      status: "published",
      generationId: "projection-1",
    })
    const { runRecommendationProfileProjection } =
      await import("./recommendationProfileProjection")
    await expect(
      runRecommendationProfileProjection({
        runId: "run-1",
        expectedGeneration: 1,
      }),
    ).resolves.toMatchObject({ status: "published" })
    expect(
      markRecommendationProfileProjectionRuntimeStarted,
    ).toHaveBeenCalledWith(
      { runId: "run-1", expectedGeneration: 1 },
      "runtime-1",
    )
    expect(
      markRecommendationProfileProjectionRuntimeStarted,
    ).toHaveBeenCalledBefore(runRecommendationProfileProjectionJob)
  })
})
