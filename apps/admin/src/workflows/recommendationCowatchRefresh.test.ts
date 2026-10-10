import { beforeEach, describe, expect, it, vi } from "vitest"

const workflow = vi.hoisted(() => ({
  getWorkflowMetadata: vi.fn(() => ({ workflowRunId: "runtime-573" })),
  sleep: vi.fn(),
}))
const reconciliation = vi.hoisted(() => ({
  markRecommendationCowatchRefreshSchedulerStarted: vi.fn(),
  nextRecommendationCowatchRefreshRunAt: vi.fn(),
  recordRecommendationCowatchRefreshHeartbeat: vi.fn(),
  runRecommendationCowatchRefreshFromScheduler: vi.fn(),
}))

vi.mock("workflow", async (original) => {
  const actual = await original<typeof import("workflow")>()
  return { ...actual, ...workflow }
})
vi.mock("@/services/recommendations/cowatch/refresh.job", () => reconciliation)

import { runRecommendationCowatchRefreshScheduler } from "./recommendationCowatchRefresh"

describe("co-watch refresh workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reconciliation.markRecommendationCowatchRefreshSchedulerStarted.mockResolvedValue(
      undefined,
    )
  })

  it("runs a bounded batch, records its aggregate heartbeat, then sleeps", async () => {
    const result = { status: "idle" }
    const next = new Date("2026-09-06T23:35:00.000Z")
    reconciliation.runRecommendationCowatchRefreshFromScheduler.mockResolvedValue(
      result,
    )
    reconciliation.nextRecommendationCowatchRefreshRunAt.mockReturnValue(next)
    reconciliation.recordRecommendationCowatchRefreshHeartbeat.mockResolvedValue(
      undefined,
    )
    workflow.sleep.mockRejectedValueOnce(new Error("stop after one cycle"))

    await expect(
      runRecommendationCowatchRefreshScheduler({
        ledgerRunId: "scheduler-ledger-573",
      }),
    ).rejects.toThrow("stop after one cycle")
    expect(
      reconciliation.markRecommendationCowatchRefreshSchedulerStarted,
    ).toHaveBeenCalledWith("scheduler-ledger-573", "runtime-573")
    expect(
      reconciliation.runRecommendationCowatchRefreshFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(
      reconciliation.recordRecommendationCowatchRefreshHeartbeat,
    ).toHaveBeenCalledWith("scheduler-ledger-573", { nextRunAt: next, result })
    expect(workflow.sleep).toHaveBeenCalledWith(next)
  })

  it("keeps the durable schedule alive when one reconciliation batch fails", async () => {
    const next = new Date("2026-09-06T23:35:00.000Z")
    reconciliation.runRecommendationCowatchRefreshFromScheduler.mockRejectedValueOnce(
      new Error("temporary database failure"),
    )
    reconciliation.nextRecommendationCowatchRefreshRunAt.mockReturnValue(next)
    reconciliation.recordRecommendationCowatchRefreshHeartbeat.mockResolvedValue(
      undefined,
    )
    workflow.sleep.mockRejectedValueOnce(new Error("stop after one cycle"))

    await expect(
      runRecommendationCowatchRefreshScheduler({
        ledgerRunId: "scheduler-ledger-573",
      }),
    ).rejects.toThrow("stop after one cycle")
    expect(
      reconciliation.recordRecommendationCowatchRefreshHeartbeat,
    ).toHaveBeenCalledWith("scheduler-ledger-573", {
      nextRunAt: next,
      result: null,
    })
    expect(workflow.sleep).toHaveBeenCalledWith(next)
  })
})
