import { describe, expect, it, vi } from "vitest"
const updateMany = vi.hoisted(() => vi.fn(async () => ({ count: 1 })))
vi.mock("@/db/client", () => ({ prisma: { workflowRun: { updateMany } } }))
import { runRecommendationProfileReconciliationScheduler } from "./recommendationProfileReconciliation"

describe("retired profile reconciliation workflow identity", () => {
  it("cancels its old ledger without scheduling work", async () => {
    await runRecommendationProfileReconciliationScheduler({
      ledgerRunId: "old",
    })
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
