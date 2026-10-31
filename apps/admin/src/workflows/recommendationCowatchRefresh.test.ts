import { describe, expect, it, vi } from "vitest"
const updateMany = vi.hoisted(() => vi.fn(async () => ({ count: 1 })))
vi.mock("@/db/client", () => ({ prisma: { workflowRun: { updateMany } } }))
import { runRecommendationCowatchRefreshScheduler } from "./recommendationCowatchRefresh"

describe("retired co-watch refresh workflow identity", () => {
  it("cancels its old ledger without scheduling work", async () => {
    await runRecommendationCowatchRefreshScheduler({ ledgerRunId: "old" })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "old", status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "CANCELLED",
        finishedAt: expect.any(Date),
        summary: "Behavioral recommendations retired.",
      },
    })
  })
})
