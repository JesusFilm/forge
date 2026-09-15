import { beforeEach, describe, expect, it, vi } from "vitest"

const workflow = vi.hoisted(() => ({
  getWorkflowMetadata: vi.fn(() => ({ workflowRunId: "runtime-459" })),
  sleep: vi.fn(),
}))
const reconciliation = vi.hoisted(() => ({
  markRecommendationProfileReconciliationSchedulerStarted: vi.fn(),
  nextRecommendationProfileReconciliationRunAt: vi.fn(),
  recordRecommendationProfileReconciliationHeartbeat: vi.fn(),
  runRecommendationProfileReconciliationFromScheduler: vi.fn(),
}))

vi.mock("workflow", async (original) => {
  const actual = await original<typeof import("workflow")>()
  return { ...actual, ...workflow }
})
vi.mock(
  "@/services/recommendations/profiles/reconciliation.job",
  () => reconciliation,
)

import { runRecommendationProfileReconciliationScheduler } from "./recommendationProfileReconciliation"

describe("profile reconciliation workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reconciliation.markRecommendationProfileReconciliationSchedulerStarted.mockResolvedValue(
      undefined,
    )
  })

  it("runs a bounded batch, records its aggregate heartbeat, then sleeps", async () => {
    const result = {
      locked: false,
      affectedPointers: 4,
      classificationsAttempted: 7,
      classificationsFailed: 0,
      rebuildsQueued: 4,
      staleRuns: 3,
      staleRunsQueued: 3,
      attemptsExhausted: 1,
      dispatchFailures: 0,
    }
    const next = new Date("2026-09-06T23:35:00.000Z")
    reconciliation.runRecommendationProfileReconciliationFromScheduler.mockResolvedValue(
      result,
    )
    reconciliation.nextRecommendationProfileReconciliationRunAt.mockReturnValue(
      next,
    )
    reconciliation.recordRecommendationProfileReconciliationHeartbeat.mockResolvedValue(
      undefined,
    )
    workflow.sleep.mockRejectedValueOnce(new Error("stop after one cycle"))

    await expect(
      runRecommendationProfileReconciliationScheduler({
        ledgerRunId: "scheduler-ledger-459",
      }),
    ).rejects.toThrow("stop after one cycle")
    expect(
      reconciliation.markRecommendationProfileReconciliationSchedulerStarted,
    ).toHaveBeenCalledWith("scheduler-ledger-459", "runtime-459")
    expect(
      reconciliation.runRecommendationProfileReconciliationFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(
      reconciliation.recordRecommendationProfileReconciliationHeartbeat,
    ).toHaveBeenCalledWith("scheduler-ledger-459", { nextRunAt: next, result })
    expect(workflow.sleep).toHaveBeenCalledWith(next)
  })

  it("keeps the durable schedule alive when one reconciliation batch fails", async () => {
    const next = new Date("2026-09-06T23:35:00.000Z")
    reconciliation.runRecommendationProfileReconciliationFromScheduler.mockRejectedValueOnce(
      new Error("temporary database failure"),
    )
    reconciliation.nextRecommendationProfileReconciliationRunAt.mockReturnValue(
      next,
    )
    reconciliation.recordRecommendationProfileReconciliationHeartbeat.mockResolvedValue(
      undefined,
    )
    workflow.sleep.mockRejectedValueOnce(new Error("stop after one cycle"))

    await expect(
      runRecommendationProfileReconciliationScheduler({
        ledgerRunId: "scheduler-ledger-459",
      }),
    ).rejects.toThrow("stop after one cycle")
    expect(
      reconciliation.recordRecommendationProfileReconciliationHeartbeat,
    ).toHaveBeenCalledWith("scheduler-ledger-459", {
      nextRunAt: next,
      result: null,
    })
    expect(workflow.sleep).toHaveBeenCalledWith(next)
  })
})
