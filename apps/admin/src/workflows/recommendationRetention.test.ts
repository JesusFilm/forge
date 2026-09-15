import { beforeEach, describe, expect, it, vi } from "vitest"
import { RetryableError } from "workflow"

const workflow = vi.hoisted(() => ({
  getWorkflowMetadata: vi.fn(() => ({
    workflowRunId: "runtime-1",
    workflowName: "runRecommendationRetentionScheduler",
    workflowStartedAt: new Date("2026-08-30T00:00:00.000Z"),
    url: "http://localhost/workflow",
  })),
  sleep: vi.fn(),
}))
const retention = vi.hoisted(() => ({
  markRecommendationRetentionSchedulerRuntimeStarted: vi.fn(),
  nextRecommendationRetentionCatchUpRunAt: vi.fn(),
  nextRecommendationRetentionRunAt: vi.fn(),
  recordRecommendationRetentionSchedulerCatchUpHeartbeat: vi.fn(),
  recordRecommendationRetentionSchedulerHeartbeat: vi.fn(),
  runRecommendationRetentionFromScheduler: vi.fn(),
  runRecommendationRetentionJob: vi.fn(),
}))

vi.mock("workflow", async (original) => {
  const actual = await original<typeof import("workflow")>()
  return { ...actual, ...workflow }
})
vi.mock("@/services/recommendations/retention/job", () => retention)

import {
  RECOMMENDATION_RETENTION_CATCH_UP_BATCH_LIMIT,
  RECOMMENDATION_RETENTION_CATCH_UP_WINDOW_MS,
  runRecommendationRetention,
  runRecommendationRetentionScheduler,
  stepMarkRecommendationRetentionSchedulerStarted,
  stepRunScheduledRecommendationRetention,
} from "./recommendationRetention"

beforeEach(() => {
  vi.clearAllMocks()
  retention.markRecommendationRetentionSchedulerRuntimeStarted.mockResolvedValue(
    undefined,
  )
  retention.runRecommendationRetentionFromScheduler.mockResolvedValue({
    ok: true,
    ledgerRunId: "purge-ledger-1",
    result: {
      status: "succeeded",
      runId: "retention-run-1",
      rootsDeleted: 0,
      rowCounts: {},
      oldestExpiredAtAfter: null,
      overdueAfterRun: false,
    },
  })
})

describe("recommendation retention workflow", () => {
  it("runs the bounded request-root purge as a workflow step", async () => {
    const result = {
      status: "succeeded",
      runId: "retention-run-1",
      rootsDeleted: 3,
      rowCounts: { requests: 3, items: 6 },
      oldestExpiredAtAfter: null,
      overdueAfterRun: false,
    }
    retention.runRecommendationRetentionJob.mockResolvedValueOnce(result)

    await expect(
      runRecommendationRetention({ ledgerRunId: "workflow-run-1" }),
    ).resolves.toEqual(result)
    expect(retention.runRecommendationRetentionJob).toHaveBeenCalledWith({
      ledgerRunId: "workflow-run-1",
    })
  })

  it("self-attaches the durable runtime before the scheduler purges", async () => {
    await stepMarkRecommendationRetentionSchedulerStarted({
      ledgerRunId: "scheduler-ledger-1",
    })

    expect(
      retention.markRecommendationRetentionSchedulerRuntimeStarted,
    ).toHaveBeenCalledWith("scheduler-ledger-1", "runtime-1")
  })

  it("dispatches the scheduled purge, records the heartbeat, then sleeps", async () => {
    const next = new Date("2026-08-20T10:30:00.000Z")
    retention.nextRecommendationRetentionRunAt.mockReturnValueOnce(next)
    retention.recordRecommendationRetentionSchedulerHeartbeat.mockResolvedValueOnce(
      undefined,
    )
    workflow.sleep.mockRejectedValueOnce(
      new Error("stop scheduler after one cycle"),
    )

    await expect(
      runRecommendationRetentionScheduler({ ledgerRunId: "scheduler-1" }),
    ).rejects.toThrow("stop scheduler after one cycle")
    expect(
      retention.markRecommendationRetentionSchedulerRuntimeStarted,
    ).toHaveBeenCalledWith("scheduler-1", "runtime-1")
    expect(
      retention.runRecommendationRetentionFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(
      retention.recordRecommendationRetentionSchedulerHeartbeat,
    ).toHaveBeenCalledWith("scheduler-1", next)
    expect(workflow.sleep).toHaveBeenCalledWith(next)
  })

  it("drains more than one 500-root batch before the daily sleep", async () => {
    const next = new Date("2026-08-20T10:30:00.000Z")
    retention.runRecommendationRetentionFromScheduler
      .mockResolvedValueOnce({
        ok: true,
        ledgerRunId: "purge-ledger-1",
        result: {
          status: "succeeded",
          runId: "retention-run-1",
          rootsDeleted: 500,
          rowCounts: { requests: 500 },
          oldestExpiredAtAfter: new Date("2026-08-01T00:00:00.000Z"),
          overdueAfterRun: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        ledgerRunId: "purge-ledger-2",
        result: {
          status: "succeeded",
          runId: "retention-run-2",
          rootsDeleted: 125,
          rowCounts: { requests: 125 },
          oldestExpiredAtAfter: null,
          overdueAfterRun: false,
        },
      })
    retention.nextRecommendationRetentionRunAt.mockReturnValueOnce(next)
    workflow.sleep.mockRejectedValueOnce(
      new Error("stop scheduler after one cycle"),
    )

    await expect(
      runRecommendationRetentionScheduler({ ledgerRunId: "scheduler-1" }),
    ).rejects.toThrow("stop scheduler after one cycle")
    expect(
      retention.runRecommendationRetentionFromScheduler,
    ).toHaveBeenCalledTimes(2)
    expect(
      retention.recordRecommendationRetentionSchedulerCatchUpHeartbeat,
    ).not.toHaveBeenCalled()
    expect(workflow.sleep).toHaveBeenCalledWith(next)
  })

  it("uses a durable short continuation when the catch-up batch cap is reached", async () => {
    const continuation = new Date("2026-08-19T12:35:56.000Z")
    retention.runRecommendationRetentionFromScheduler.mockResolvedValue({
      ok: true,
      ledgerRunId: "purge-ledger-1",
      result: {
        status: "succeeded",
        runId: "retention-run-1",
        rootsDeleted: 500,
        rowCounts: { requests: 500 },
        oldestExpiredAtAfter: new Date("2026-08-01T00:00:00.000Z"),
        overdueAfterRun: true,
      },
    })
    retention.nextRecommendationRetentionCatchUpRunAt.mockReturnValueOnce(
      continuation,
    )
    workflow.sleep.mockRejectedValueOnce(
      new Error("stop scheduler after catch-up continuation"),
    )

    await expect(
      runRecommendationRetentionScheduler({ ledgerRunId: "scheduler-1" }),
    ).rejects.toThrow("stop scheduler after catch-up continuation")
    expect(
      retention.runRecommendationRetentionFromScheduler,
    ).toHaveBeenCalledTimes(RECOMMENDATION_RETENTION_CATCH_UP_BATCH_LIMIT)
    expect(
      retention.recordRecommendationRetentionSchedulerCatchUpHeartbeat,
    ).toHaveBeenCalledWith("scheduler-1", continuation)
    expect(retention.nextRecommendationRetentionRunAt).not.toHaveBeenCalled()
    expect(workflow.sleep).toHaveBeenCalledWith(continuation)
  })

  it("keeps the daily scheduler alive after bounded purge retries exhaust", async () => {
    const next = new Date("2026-08-20T10:30:00.000Z")
    retention.runRecommendationRetentionFromScheduler.mockResolvedValueOnce({
      ok: false,
      ledgerRunId: "failed-run",
      error: "database unavailable",
    })
    retention.nextRecommendationRetentionRunAt.mockReturnValueOnce(next)
    retention.recordRecommendationRetentionSchedulerHeartbeat.mockResolvedValueOnce(
      undefined,
    )
    workflow.sleep.mockRejectedValueOnce(
      new Error("stop scheduler after one cycle"),
    )

    await expect(
      runRecommendationRetentionScheduler({ ledgerRunId: "scheduler-1" }),
    ).rejects.toThrow("stop scheduler after one cycle")
    expect(
      retention.runRecommendationRetentionFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(
      retention.recordRecommendationRetentionSchedulerHeartbeat,
    ).toHaveBeenCalledWith("scheduler-1", next)
    expect(workflow.sleep).toHaveBeenCalledWith(next)
  })

  it("turns a recorded purge failure into a bounded retryable step", async () => {
    retention.runRecommendationRetentionFromScheduler.mockResolvedValueOnce({
      ok: false,
      ledgerRunId: "purge-ledger-1",
      error: "private database detail",
    })

    await expect(stepRunScheduledRecommendationRetention()).rejects.toSatisfy(
      (error: unknown) =>
        RetryableError.is(error) &&
        error.message === "Recommendation retention purge failed",
    )
    expect(stepRunScheduledRecommendationRetention.maxRetries).toBe(5)
  })

  it("returns the catch-up state after a scheduled purge succeeds", async () => {
    await expect(stepRunScheduledRecommendationRetention()).resolves.toEqual({
      batchesProcessed: 1,
      overdueAfterRun: false,
    })
  })

  it("stops a catch-up pass when its wall-clock budget is exhausted", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(RECOMMENDATION_RETENTION_CATCH_UP_WINDOW_MS + 1)
    retention.runRecommendationRetentionFromScheduler.mockResolvedValueOnce({
      ok: true,
      ledgerRunId: "purge-ledger-1",
      result: {
        status: "succeeded",
        runId: "retention-run-1",
        rootsDeleted: 500,
        rowCounts: { requests: 500 },
        oldestExpiredAtAfter: new Date("2026-08-01T00:00:00.000Z"),
        overdueAfterRun: true,
      },
    })

    await expect(stepRunScheduledRecommendationRetention()).resolves.toEqual({
      batchesProcessed: 1,
      overdueAfterRun: true,
    })
    expect(
      retention.runRecommendationRetentionFromScheduler,
    ).toHaveBeenCalledOnce()
    now.mockRestore()
  })
})
