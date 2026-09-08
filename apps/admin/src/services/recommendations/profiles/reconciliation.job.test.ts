import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const runtimeRunGet = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}))
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  workflowRun: { findFirst: vi.fn(), update: vi.fn() },
}))
const transaction = vi.hoisted(() => vi.fn())
const runBatch = vi.hoisted(() => vi.fn())
const workflowLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunRuntimeStarted: vi.fn(),
}))

vi.mock("workflow/api", () => ({ start }))
vi.mock("workflow/runtime", () => ({
  getWorld: () => ({ runs: { get: runtimeRunGet } }),
}))
vi.mock("@/db/client", () => ({
  prisma: { workflowRun, $transaction: transaction },
}))
vi.mock("@/services/workflow-run-log.service", () => workflowLog)
vi.mock("./reconciliation.service", () => ({
  runRecommendationProfileReconciliationBatch: runBatch,
}))

import {
  ensureRecommendationProfileReconciliationSchedulerStarted,
  nextRecommendationProfileReconciliationRunAt,
  recordRecommendationProfileReconciliationHeartbeat,
} from "./reconciliation.job"
import { runRecommendationProfileReconciliationScheduler } from "@/workflows/recommendationProfileReconciliation"

const NOW = new Date("2026-09-06T23:30:00.000Z")

describe("profile reconciliation scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowRun.findFirst.mockResolvedValue(null)
    workflowRun.update.mockResolvedValue({})
    tx.$queryRaw.mockResolvedValue([{ locked: true }])
    tx.workflowRun.findFirst.mockResolvedValue(null)
    tx.workflowRun.update.mockResolvedValue({})
    transaction.mockImplementation(async (work) => work(tx))
    workflowLog.createWorkflowRunLog.mockResolvedValue({ id: "ledger-459" })
    workflowLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
    workflowLog.markWorkflowRunFailed.mockResolvedValue(undefined)
    workflowLog.markWorkflowRunRuntimeStarted.mockResolvedValue(undefined)
    start.mockResolvedValue({ runId: "runtime-459" })
  })

  it("uses an exact five-minute bounded cadence", () => {
    expect(nextRecommendationProfileReconciliationRunAt(NOW)).toEqual(
      new Date("2026-09-06T23:35:00.000Z"),
    )
  })

  it("starts one separately identified durable scheduler under a lock", async () => {
    await expect(
      ensureRecommendationProfileReconciliationSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-459",
      ledgerRunId: "ledger-459",
    })
    expect(start).toHaveBeenCalledWith(
      runRecommendationProfileReconciliationScheduler,
      [{ ledgerRunId: "ledger-459" }],
    )
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowKey: "recommendation-profile-reconciliation-scheduler",
        details: { schedule: "every 5 minutes", batchSize: 100 },
      }),
      tx,
    )
    expect(workflowLog.attachWorkflowRuntimeRunId).toHaveBeenCalledWith(
      "ledger-459",
      "runtime-459",
    )
  })

  it("does not duplicate a fresh active scheduler", async () => {
    const existing = {
      id: "existing-ledger",
      runtimeRunId: null,
      updatedAt: new Date(),
    }
    workflowRun.findFirst.mockResolvedValue(existing)
    tx.workflowRun.findFirst.mockResolvedValue(existing)

    await expect(
      ensureRecommendationProfileReconciliationSchedulerStarted(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "existing-ledger",
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("does not duplicate an active runtime when its heartbeat is stale", async () => {
    const existing = {
      id: "slow-ledger",
      runtimeRunId: "slow-runtime",
      updatedAt: new Date("2026-09-06T22:00:00.000Z"),
    }
    workflowRun.findFirst.mockResolvedValue(existing)
    tx.workflowRun.findFirst.mockResolvedValue(existing)
    runtimeRunGet.mockResolvedValue({ status: "running", error: null })

    await expect(
      ensureRecommendationProfileReconciliationSchedulerStarted(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "slow-ledger",
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("replaces a scheduler whose runtime failed after start returned", async () => {
    const existing = {
      id: "failed-ledger",
      runtimeRunId: "failed-runtime",
      updatedAt: NOW,
    }
    workflowRun.findFirst.mockResolvedValue(existing)
    tx.workflowRun.findFirst.mockResolvedValue(existing)
    runtimeRunGet.mockResolvedValue({
      status: "failed",
      error: { message: "WorkflowNotRegisteredError" },
    })

    await expect(
      ensureRecommendationProfileReconciliationSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-459",
      ledgerRunId: "ledger-459",
    })
    expect(tx.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "failed-ledger" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "WorkflowNotRegisteredError",
      }),
    })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("records only privacy-safe aggregate batch evidence", async () => {
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
    await recordRecommendationProfileReconciliationHeartbeat("ledger-459", {
      nextRunAt: new Date("2026-09-06T23:35:00.000Z"),
      result,
    })
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-459" },
      data: expect.objectContaining({
        details: expect.objectContaining({ lastBatch: result }),
      }),
    })
    expect(JSON.stringify(workflowRun.update.mock.calls[0])).not.toMatch(
      /profileId|sessionDigest|sourceId|requestId/i,
    )
  })
})
