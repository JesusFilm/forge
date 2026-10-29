import { beforeEach, describe, expect, it, vi } from "vitest"
const start = vi.hoisted(() => vi.fn())
const updateMany = vi.hoisted(() => vi.fn(async () => ({ count: 1 })))
const transaction = vi.hoisted(() => vi.fn())
vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({
  prisma: {
    recommendationProfileProjectionRun: { updateMany },
    $transaction: transaction,
  },
}))
import {
  dispatchRecommendationProfileProjection,
  dispatchRecommendationProfileFeedback,
  redispatchRecommendationProfileProjectionRun,
  runRecommendationProfileProjectionJob,
} from "./job"
beforeEach(() => vi.clearAllMocks())
describe("retired profile projection", () => {
  it("rejects manual and retry dispatch without queuing or creating rows", async () => {
    await expect(
      dispatchRecommendationProfileProjection({
        sessionDigest: "a".repeat(64),
        profileId: null,
        privacyGeneration: null,
      }),
    ).rejects.toThrow("retired")
    await expect(
      redispatchRecommendationProfileProjectionRun({
        runId: "old",
        expectedGeneration: 1,
      }),
    ).rejects.toThrow("retired")
    expect(start).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
  it("ignores late playback feedback", async () => {
    await expect(
      dispatchRecommendationProfileFeedback({
        sessionDigest: "a".repeat(64),
        profileId: "old",
        privacyGeneration: 1,
        evidenceWatermark: new Date(),
      }),
    ).resolves.toMatchObject({
      durable: null,
      skipped: "behavioral_recommendations_retired",
    })
    expect(start).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
  it("fences a pending durable replay without publishing another generation", async () => {
    await expect(
      runRecommendationProfileProjectionJob({
        runId: "old",
        expectedGeneration: 1,
      }),
    ).resolves.toEqual({
      status: "fenced",
      reason: "behavioral_recommendations_retired",
    })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "old", state: { in: ["PENDING", "CLAIMED"] } },
        data: expect.objectContaining({
          state: "FENCED",
          failureReason: "behavioral_recommendations_retired",
        }),
      }),
    )
    expect(start).not.toHaveBeenCalled()
  })
})
