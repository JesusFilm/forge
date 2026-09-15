import { beforeEach, describe, expect, it, vi } from "vitest"

const start = vi.hoisted(() => vi.fn())
const runtimeRunGet = vi.hoisted(() => vi.fn())
const evaluate = vi.hoisted(() => vi.fn())
const servingControl = vi.hoisted(() => ({ findUnique: vi.fn() }))
const workflowRun = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}))
const transaction = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  workflowRun: { findFirst: vi.fn(), update: vi.fn() },
}))
const prismaTransaction = vi.hoisted(() => vi.fn())
const workflowLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunRuntimeStarted: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
}))

vi.mock("workflow/api", () => ({ start }))
vi.mock("workflow/runtime", () => ({
  getWorld: () => ({ runs: { get: runtimeRunGet } }),
}))
vi.mock("@/db/client", () => ({
  prisma: {
    recommendationServingControl: servingControl,
    workflowRun,
    $transaction: prismaTransaction,
  },
}))
vi.mock("@/services/workflow-run-log.service", () => workflowLog)
vi.mock("./service", () => ({
  createRecommendationControlReadinessService: vi.fn(() => ({ evaluate })),
}))

import {
  ensureRecommendationControlReadinessSchedulerStarted,
  resolveRecommendationControlWindow,
  runRecommendationControlReadinessFromScheduler,
  runRecommendationControlReadinessJob,
} from "./job"
import { runRecommendationControlReadinessScheduler } from "@/workflows/recommendationControlReadiness"

const NOW = new Date("2026-08-19T12:34:56.000Z")

describe("recommendation control readiness job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowLog.createWorkflowRunLog.mockResolvedValue({ id: "ledger-1" })
    servingControl.findUnique.mockResolvedValue({
      version: 7,
      manifestId: "semantic-transcript-pgvector-v1",
    })
    workflowRun.update.mockResolvedValue({})
    workflowRun.findFirst.mockResolvedValue(null)
    workflowLog.markWorkflowRunStarted.mockResolvedValue(undefined)
    workflowLog.markWorkflowRunFailed.mockResolvedValue(undefined)
    workflowLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
    transaction.$queryRaw.mockResolvedValue([{ locked: true }])
    transaction.workflowRun.findFirst.mockResolvedValue(null)
    transaction.workflowRun.update.mockResolvedValue({})
    prismaTransaction.mockImplementation(async (callback) =>
      callback(transaction),
    )
  })

  it("pins a closed seven-day cohort before creating the workflow ledger", async () => {
    evaluate.mockResolvedValue({
      status: "published",
      evaluationId: "evaluation-1",
      revision: 1,
      state: "ready",
    })

    await expect(
      runRecommendationControlReadinessFromScheduler({ now: NOW }),
    ).resolves.toMatchObject({ ok: true, ledgerRunId: "ledger-1" })

    const window = resolveRecommendationControlWindow(NOW)
    expect(window).toEqual({
      windowStart: new Date("2026-08-12T06:00:00.000Z"),
      windowEnd: new Date("2026-08-19T06:00:00.000Z"),
    })
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowKey: "recommendation-control-readiness",
        subjectType: "recommendation-strategy-manifest",
        subjectId: "semantic-transcript-pgvector-v1",
        details: expect.objectContaining({
          expectedServingControlVersion: 7,
          expectedManifestId: "semantic-transcript-pgvector-v1",
          windowStart: window.windowStart.toISOString(),
          windowEnd: window.windowEnd.toISOString(),
        }),
      }),
    )
    expect(workflowLog.createWorkflowRunLog).toHaveBeenCalledBefore(evaluate)
    expect(evaluate).toHaveBeenCalledWith({
      ...window,
      expectedServingControlVersion: 7,
      expectedManifestId: "semantic-transcript-pgvector-v1",
    })
  })

  it("records stale workflow fencing as a skipped, inspectable run", async () => {
    evaluate.mockResolvedValue({
      status: "fenced",
      reason: "serving_control_version_changed",
    })

    await expect(
      runRecommendationControlReadinessJob({
        ledgerRunId: "ledger-1",
        expectedServingControlVersion: 7,
        expectedManifestId: "semantic-transcript-pgvector-v1",
        windowStart: "2026-08-12T06:00:00.000Z",
        windowEnd: "2026-08-19T06:00:00.000Z",
      }),
    ).resolves.toEqual({
      status: "fenced",
      reason: "serving_control_version_changed",
    })
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-1" },
      data: expect.objectContaining({
        status: "SKIPPED",
        summary: expect.stringContaining("fenced"),
        details: expect.objectContaining({
          reason: "serving_control_version_changed",
        }),
      }),
    })
  })

  it("starts at most one fresh durable scheduler under an advisory lock", async () => {
    start.mockResolvedValue({ runId: "runtime-1" })

    await expect(
      ensureRecommendationControlReadinessSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(start).toHaveBeenCalledWith(
      runRecommendationControlReadinessScheduler,
      [{ ledgerRunId: "ledger-1" }],
    )
    expect(workflowLog.attachWorkflowRuntimeRunId).toHaveBeenCalledWith(
      "ledger-1",
      "runtime-1",
    )
    expect(prismaTransaction).toHaveBeenCalledOnce()
    const lockTemplate = transaction.$queryRaw.mock.calls[0]?.[0]
    expect(Array.from(lockTemplate).join("?")).toContain(
      "pg_try_advisory_xact_lock",
    )
  })

  it("reconciles a failed attached runtime before starting a replacement", async () => {
    runtimeRunGet.mockResolvedValueOnce({
      status: "failed",
      error: { message: "Workflow was not registered." },
    })
    const terminalLedger = {
      id: "terminal-ledger",
      runtimeRunId: "terminal-runtime",
    }
    workflowRun.findFirst.mockResolvedValueOnce(terminalLedger)
    transaction.workflowRun.findFirst.mockResolvedValueOnce(terminalLedger)
    start.mockResolvedValueOnce({ runId: "runtime-1" })

    await expect(
      ensureRecommendationControlReadinessSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(transaction.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "terminal-ledger" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "Semantic control readiness scheduler runtime failed.",
        error: "Workflow was not registered.",
        finishedAt: expect.any(Date),
      }),
    })
    expect(runtimeRunGet).toHaveBeenCalledBefore(prismaTransaction)
    expect(start).toHaveBeenCalledOnce()
  })

  it("keeps a fresh ledger while its attached runtime is active", async () => {
    runtimeRunGet.mockResolvedValueOnce({ status: "running" })
    const activeLedger = {
      id: "active-ledger",
      runtimeRunId: "active-runtime",
    }
    workflowRun.findFirst.mockResolvedValueOnce(activeLedger)
    transaction.workflowRun.findFirst.mockResolvedValueOnce(activeLedger)

    await expect(
      ensureRecommendationControlReadinessSchedulerStarted(),
    ).resolves.toEqual({
      started: false,
      ledgerRunId: "active-ledger",
    })
    expect(transaction.workflowRun.update).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("bounds a stalled runtime lookup before reserving the ledger", async () => {
    vi.useFakeTimers()
    try {
      runtimeRunGet.mockReturnValueOnce(new Promise(() => undefined))
      const stalledLedger = {
        id: "stalled-ledger",
        runtimeRunId: "stalled-runtime",
      }
      workflowRun.findFirst.mockResolvedValueOnce(stalledLedger)
      transaction.workflowRun.findFirst.mockResolvedValueOnce(stalledLedger)

      const result = ensureRecommendationControlReadinessSchedulerStarted()
      await vi.advanceTimersByTimeAsync(1_000)
      await expect(result).resolves.toEqual({
        started: false,
        ledgerRunId: "stalled-ledger",
      })
      expect(prismaTransaction).toHaveBeenCalledOnce()
      expect(transaction.workflowRun.update).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not create a scheduler when the advisory lock is held", async () => {
    transaction.$queryRaw.mockResolvedValueOnce([{ locked: false }])

    await expect(
      ensureRecommendationControlReadinessSchedulerStarted(),
    ).resolves.toEqual({ started: false })
    expect(workflowLog.createWorkflowRunLog).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("keeps an already-started scheduler active when attachment fails", async () => {
    start.mockResolvedValue({ runId: "runtime-1" })
    workflowLog.attachWorkflowRuntimeRunId.mockRejectedValueOnce(
      new Error("attachment unavailable"),
    )

    await expect(
      ensureRecommendationControlReadinessSchedulerStarted(),
    ).resolves.toEqual({
      started: true,
      runId: "runtime-1",
      ledgerRunId: "ledger-1",
    })
    expect(workflowLog.markWorkflowRunFailed).not.toHaveBeenCalled()
  })
})
