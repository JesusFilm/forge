import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const runtimeRunGet = vi.hoisted(() => vi.fn())
const purgeExpiredRecommendationRequests = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}))
const transaction = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  workflowRun: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))
const prismaTransaction = vi.hoisted(() => vi.fn())
const workflowLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
}))

vi.mock("workflow/api", () => ({ start }))
vi.mock("workflow/runtime", () => ({
  getWorld: () => ({ runs: { get: runtimeRunGet } }),
}))
vi.mock("@/db/client", () => ({
  prisma: {
    workflowRun,
    $transaction: prismaTransaction,
  },
}))
vi.mock("@/services/workflow-run-log.service", () => workflowLog)
vi.mock("@/services/recommendations/retention.service", async (original) => {
  const actual =
    await original<
      typeof import("@/services/recommendations/retention.service")
    >()
  return { ...actual, purgeExpiredRecommendationRequests }
})

import {
  ensureRecommendationRetentionSchedulerStarted,
  markRecommendationRetentionSchedulerRuntimeStarted,
  recordRecommendationRetentionSchedulerHeartbeat,
  runRecommendationRetentionFromScheduler,
  runRecommendationRetentionJob,
} from "./job"
import { RecommendationInternalStateError } from "../errors"
import { runRecommendationRetentionScheduler } from "@/workflows/recommendationRetention"

const purgeResult = {
  status: "succeeded" as const,
  runId: "purge-run-1",
  rootsDeleted: 2,
  rowCounts: { requests: 2 },
  oldestExpiredAtAfter: null,
  overdueAfterRun: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  workflowRun.findFirst.mockResolvedValue(null)
  workflowRun.update.mockResolvedValue({})
  workflowRun.updateMany.mockResolvedValue({ count: 1 })
  transaction.$queryRaw.mockResolvedValue([{ locked: true }])
  transaction.workflowRun.findFirst.mockResolvedValue(null)
  prismaTransaction.mockImplementation(async (work) => work(transaction))
  workflowLog.createWorkflowRunLog.mockResolvedValue({ id: "ledger-1" })
  workflowLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
  workflowLog.markWorkflowRunFailed.mockResolvedValue(undefined)
  workflowLog.markWorkflowRunStarted.mockResolvedValue(undefined)
  purgeExpiredRecommendationRequests.mockResolvedValue(purgeResult)
  start.mockResolvedValue({ runId: "runtime-1" })
})

describe("recommendation retention job", () => {
  it("runs the purge and records the purge ledger lifecycle", async () => {
    await expect(
      runRecommendationRetentionJob({ ledgerRunId: "ledger-1" }),
    ).resolves.toEqual(purgeResult)
    expect(workflowLog.markWorkflowRunStarted).toHaveBeenCalledWith("ledger-1")
    expect(purgeExpiredRecommendationRequests).toHaveBeenCalledOnce()
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-1" },
      data: expect.objectContaining({
        status: "SUCCEEDED",
        summary: "Purged 2 recommendation request root(s).",
      }),
    })
  })

  it("creates a scheduled purge ledger before running the purge", async () => {
    await expect(runRecommendationRetentionFromScheduler()).resolves.toEqual({
      ok: true,
      ledgerRunId: "ledger-1",
      result: purgeResult,
    })
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowKey: "recommendation-retention",
        trigger: "scheduled",
      }),
    )
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledBefore(
      purgeExpiredRecommendationRequests,
    )
    expect(workflowLog.markWorkflowRunStarted).toHaveBeenCalledWith("ledger-1")
  })

  it("returns a bounded failure after the scheduled purge ledger records it", async () => {
    purgeExpiredRecommendationRequests.mockRejectedValueOnce(
      new Error("database unavailable"),
    )

    await expect(runRecommendationRetentionFromScheduler()).resolves.toEqual({
      ok: false,
      ledgerRunId: "ledger-1",
      error: "database unavailable",
    })
    expect(workflowLog.markWorkflowRunFailed).toHaveBeenCalledWith(
      "ledger-1",
      expect.objectContaining({ message: "database unavailable" }),
    )
  })

  it("persists the scheduler heartbeat and next daily run", async () => {
    const next = new Date("2026-08-20T10:30:00.000Z")
    await recordRecommendationRetentionSchedulerHeartbeat("scheduler-1", next)
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "scheduler-1" },
      data: {
        summary:
          "Recommendation retention scheduler sleeping until 2026-08-20T10:30:00.000Z.",
        details: {
          nextRunAt: "2026-08-20T10:30:00.000Z",
          schedule: "daily 10:30 UTC",
        },
      },
    })
  })

  it("reserves scheduler startup under one transaction-scoped advisory lock", async () => {
    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(prismaTransaction).toHaveBeenCalledOnce()
    const lockTemplate = transaction.$queryRaw.mock.calls[0]?.[0]
    expect(Array.from(lockTemplate).join("?")).toContain(
      "pg_try_advisory_xact_lock",
    )
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowKey: "recommendation-retention-scheduler",
      }),
      transaction,
    )
    expect(start).toHaveBeenCalledWith(runRecommendationRetentionScheduler, [
      { ledgerRunId: "ledger-1" },
    ])
    expect(workflowLog.attachWorkflowRuntimeRunId).toHaveBeenCalledWith(
      "ledger-1",
      "runtime-1",
    )
  })

  it("marks only an actual runtime start failure as a failed dispatch", async () => {
    const failure = new Error("workflow unavailable")
    start.mockRejectedValueOnce(failure)

    await expect(ensureRecommendationRetentionSchedulerStarted()).rejects.toBe(
      failure,
    )
    expect(workflowLog.markWorkflowRunFailed).toHaveBeenCalledWith(
      "ledger-1",
      failure,
    )
    expect(workflowLog.attachWorkflowRuntimeRunId).not.toHaveBeenCalled()
  })

  it("keeps a successfully started runtime authoritative when attachment is delayed", async () => {
    workflowLog.attachWorkflowRuntimeRunId.mockRejectedValueOnce(
      new Error("database unavailable"),
    )
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(workflowLog.markWorkflowRunFailed).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("retention_scheduler_attachment_pending"),
    )
    warning.mockRestore()
  })

  it("lets the durable runtime self-attach and mark the scheduler running", async () => {
    await markRecommendationRetentionSchedulerRuntimeStarted(
      "ledger-1",
      "runtime-1",
    )

    expect(workflowRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "ledger-1",
        workflowKey: "recommendation-retention-scheduler",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        runtimeRunId: "runtime-1",
        status: "RUNNING",
        startedAt: expect.any(Date),
        summary: "Recommendation retention scheduler running.",
      },
    })
  })

  it("raises a stable internal-state error when the scheduler ledger cannot self-attach", async () => {
    workflowRun.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(
      markRecommendationRetentionSchedulerRuntimeStarted(
        "missing-ledger",
        "runtime-1",
      ),
    ).rejects.toEqual(
      new RecommendationInternalStateError(
        "retention_scheduler_ledger_unavailable",
      ),
    )
  })

  it("replaces a queued scheduler ledger when its runtime run already failed", async () => {
    runtimeRunGet.mockResolvedValueOnce({
      status: "failed",
      error: { message: "Workflow was not registered." },
    })
    const staleLedger = {
      id: "stale-ledger-run",
      runtimeRunId: "failed-runtime-run",
    }
    workflowRun.findFirst.mockResolvedValueOnce(staleLedger)
    transaction.workflowRun.findFirst.mockResolvedValueOnce(staleLedger)

    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(transaction.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "stale-ledger-run" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "Recommendation retention scheduler runtime failed.",
        error: "Workflow was not registered.",
        finishedAt: expect.any(Date),
      }),
    })
    expect(runtimeRunGet).toHaveBeenCalledBefore(prismaTransaction)
    expect(start).toHaveBeenCalledOnce()
  })

  it("replaces a cancelled runtime with a fresh scheduler ledger", async () => {
    runtimeRunGet.mockResolvedValueOnce({ status: "cancelled" })
    const cancelledLedger = {
      id: "cancelled-ledger-run",
      runtimeRunId: "cancelled-runtime-run",
    }
    workflowRun.findFirst.mockResolvedValueOnce(cancelledLedger)
    transaction.workflowRun.findFirst.mockResolvedValueOnce(cancelledLedger)

    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(transaction.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "cancelled-ledger-run" },
      data: expect.objectContaining({
        status: "CANCELLED",
        summary: "Recommendation retention scheduler runtime cancelled.",
      }),
    })
  })

  it("keeps a queued scheduler ledger while its runtime run is active", async () => {
    runtimeRunGet.mockResolvedValueOnce({ status: "running" })
    const activeLedger = {
      id: "active-ledger-run",
      runtimeRunId: "active-runtime-run",
    }
    workflowRun.findFirst.mockResolvedValueOnce(activeLedger)
    transaction.workflowRun.findFirst.mockResolvedValueOnce(activeLedger)

    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "active-ledger-run",
    })
    expect(transaction.workflowRun.update).not.toHaveBeenCalled()
    expect(workflowLog.createWorkflowRunLog).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("keeps an unattached active ledger instead of starting a duplicate scheduler", async () => {
    const attachingLedger = {
      id: "attaching-ledger-run",
      runtimeRunId: null,
    }
    workflowRun.findFirst.mockResolvedValueOnce(attachingLedger)
    transaction.workflowRun.findFirst.mockResolvedValueOnce(attachingLedger)

    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "attaching-ledger-run",
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("keeps the public ledger when the runtime run cannot be loaded", async () => {
    runtimeRunGet.mockRejectedValueOnce(new Error("runtime unavailable"))
    const unknownLedger = {
      id: "unknown-ledger-run",
      runtimeRunId: "unknown-runtime-run",
    }
    workflowRun.findFirst.mockResolvedValueOnce(unknownLedger)
    transaction.workflowRun.findFirst.mockResolvedValueOnce(unknownLedger)

    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "unknown-ledger-run",
    })
    expect(transaction.workflowRun.update).not.toHaveBeenCalled()
    expect(workflowLog.createWorkflowRunLog).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("bounds a stalled runtime lookup before reserving the ledger", async () => {
    vi.useFakeTimers()
    try {
      runtimeRunGet.mockReturnValueOnce(new Promise(() => undefined))
      const stalledLedger = {
        id: "stalled-ledger-run",
        runtimeRunId: "stalled-runtime-run",
      }
      workflowRun.findFirst.mockResolvedValueOnce(stalledLedger)
      transaction.workflowRun.findFirst.mockResolvedValueOnce(stalledLedger)

      const result = ensureRecommendationRetentionSchedulerStarted()
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(result).resolves.toEqual({
        started: false,
        ledgerRunId: "stalled-ledger-run",
      })
      expect(prismaTransaction).toHaveBeenCalledOnce()
      expect(transaction.workflowRun.update).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not reconcile a different ledger discovered under the lock", async () => {
    runtimeRunGet.mockResolvedValueOnce({ status: "failed" })
    workflowRun.findFirst.mockResolvedValueOnce({
      id: "inspected-ledger-run",
      runtimeRunId: "inspected-runtime-run",
    })
    transaction.workflowRun.findFirst.mockResolvedValueOnce({
      id: "replacement-ledger-run",
      runtimeRunId: "replacement-runtime-run",
    })

    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "replacement-ledger-run",
    })
    expect(transaction.workflowRun.update).not.toHaveBeenCalled()
    expect(workflowLog.createWorkflowRunLog).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("does not create or start a scheduler when the transaction lock is held", async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ locked: false }])
    await expect(
      ensureRecommendationRetentionSchedulerStarted(),
    ).resolves.toEqual({ started: false })
    expect(workflowLog.createWorkflowRunLog).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })
})
