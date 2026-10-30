import { describe, expect, it } from "vitest"
import { runRecommendationProfileProjection } from "./recommendationProfileProjection"

describe("retired profile projection workflow identity", () => {
  it("refuses resumed behavioral work", async () => {
    await expect(
      runRecommendationProfileProjection({
        runId: "old",
        expectedGeneration: 1,
      }),
    ).rejects.toThrow("behavioral_recommendations_retired")
  })
})
