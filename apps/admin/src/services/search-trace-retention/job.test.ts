import { beforeEach, describe, expect, it, vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const start = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({
  create: vi.fn(async (args) => ({ id: "ledger-run-1", ...args.data })),
  findFirst: vi.fn(),
  update: vi.fn(async (args) => args),
}))
const queryRaw = vi.hoisted(() => vi.fn())
const purgeExpiredSearchTraces = vi.hoisted(() => vi.fn())

vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({ prisma: { $queryRaw: queryRaw, workflowRun } }))
vi.mock("@/services/search-trace-retention.service", async (original) => {
  const actual =
    await original<typeof import("@/services/search-trace-retention.service")>()
  return {
    ...actual,
    purgeExpiredSearchTraces,
  }
})

describe("search trace retention workflow job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryRaw.mockResolvedValue([{ locked: true }])
    workflowRun.findFirst.mockResolvedValue(null)
    purgeExpiredSearchTraces.mockResolvedValue({
      purgedCount: 0,
      purgedRawTraceCount: 0,
      purgedGeneratedCandidateCount: 0,
      purgedWatchSearchEventCount: 0,
      purgedQueryEmbeddingCacheCount: 0,
      purgedSeoEvidenceObservationCount: 0,
      purgedSeoTicketOutboxAttemptCount: 0,
      purgedSeoApprovalNonceCount: 0,
      purgedSeoWorkloadAssertionCount: 0,
      purgedSeoLessonCount: 0,
      redactedSeoProposalVersionCount: 0,
      redactedSeoDecisionCount: 0,
      redactedSeoExperimentCount: 0,
      purgedBefore: "2026-05-30T00:00:00.000Z",
      redactedBefore: "2019-05-30T00:00:00.000Z",
    })
  })

  it("calculates the next daily UTC purge time", async () => {
    const { nextSearchTraceRetentionRunAt } = await import("./job")

    expect(
      nextSearchTraceRetentionRunAt(new Date("2026-05-14T09:59:00.000Z")),
    ).toEqual(new Date("2026-05-14T10:00:00.000Z"))
    expect(
      nextSearchTraceRetentionRunAt(new Date("2026-05-14T10:00:00.000Z")),
    ).toEqual(new Date("2026-05-15T10:00:00.000Z"))
  })

  it("keeps a just-after-purge trace under 30 days with 29-day expiry plus daily purge", async () => {
    const { nextSearchTraceRetentionRunAt } = await import("./job")
    const createdAt = new Date("2026-05-01T10:01:00.000Z")
    const rawExpiresAt = new Date(
      createdAt.getTime() + 29 * 24 * 60 * 60 * 1000,
    )
    const purgeAt = nextSearchTraceRetentionRunAt(rawExpiresAt)
    const ageAtPurge = purgeAt.getTime() - createdAt.getTime()

    expect(ageAtPurge).toBeLessThan(30 * 24 * 60 * 60 * 1000)
  })

  it("starts one durable scheduler workflow when none is running", async () => {
    start.mockResolvedValueOnce({
      runId: "scheduler-runtime-run-1",
      returnValue: Promise.resolve(undefined),
    })
    const { ensureSearchTraceRetentionSchedulerStarted } = await import("./job")
    const { runSearchTraceRetentionScheduler } =
      await import("@/workflows/searchTraceRetention")

    await expect(ensureSearchTraceRetentionSchedulerStarted()).resolves.toEqual(
      {
        started: true,
        runId: "scheduler-runtime-run-1",
        ledgerRunId: "ledger-run-1",
      },
    )
    expect(workflowRun.findFirst).toHaveBeenCalledWith({
      where: {
        workflowKey: "search-trace-retention-scheduler",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    })
    expect(start).toHaveBeenCalledWith(runSearchTraceRetentionScheduler, [
      { ledgerRunId: "ledger-run-1" },
    ])
  })

  it("does not start a duplicate scheduler when one is already active", async () => {
    workflowRun.findFirst.mockResolvedValueOnce({
      id: "existing-ledger-run",
      runtimeRunId: "existing-runtime-run",
      updatedAt: new Date(),
    })
    const { ensureSearchTraceRetentionSchedulerStarted } = await import("./job")

    await expect(ensureSearchTraceRetentionSchedulerStarted()).resolves.toEqual(
      {
        started: false,
        reason: "already-running",
        ledgerRunId: "existing-ledger-run",
        runtimeRunId: "existing-runtime-run",
      },
    )
    expect(start).not.toHaveBeenCalled()
  })

  it("marks a stale active scheduler failed and starts a replacement", async () => {
    start.mockResolvedValueOnce({
      runId: "scheduler-runtime-run-2",
      returnValue: Promise.resolve(undefined),
    })
    workflowRun.findFirst.mockResolvedValueOnce({
      id: "stale-ledger-run",
      runtimeRunId: "stale-runtime-run",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    const { ensureSearchTraceRetentionSchedulerStarted } = await import("./job")

    await expect(ensureSearchTraceRetentionSchedulerStarted()).resolves.toEqual(
      {
        started: true,
        runId: "scheduler-runtime-run-2",
        ledgerRunId: "ledger-run-1",
      },
    )
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "stale-ledger-run" },
      data: expect.objectContaining({
        status: "FAILED",
        summary:
          "Search trace retention scheduler stale; starting a replacement.",
        error: "scheduler_stale",
        finishedAt: expect.any(Date),
      }),
    })
    expect(start).toHaveBeenCalledOnce()
  })

  it("dispatches the purge workflow through useworkflow", async () => {
    const dispatch = wrapStartSpy(start)
    start.mockResolvedValueOnce({
      runId: "runtime-run-1",
      returnValue: Promise.resolve(undefined),
    })
    const { dispatchSearchTraceRetention } = await import("./job")
    const { runSearchTraceRetention } =
      await import("@/workflows/searchTraceRetention")

    await expect(
      dispatchSearchTraceRetention({ trigger: "scheduled" }),
    ).resolves.toEqual({
      workflow: "search-trace-retention",
      runId: "runtime-run-1",
      trigger: "scheduled",
      status: "queued",
    })
    dispatch.expectDispatched(runSearchTraceRetention, [
      { trigger: "scheduled", ledgerRunId: "ledger-run-1" },
    ])
    expect(workflowRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowKey: "search-trace-retention",
        workflowName: "Search Trace Retention",
        trigger: "SCHEDULED",
        subjectType: "search-trace",
        subjectId: "raw",
      }),
    })
  })

  it("marks the ledger succeeded after purge completes with counts only", async () => {
    purgeExpiredSearchTraces.mockResolvedValueOnce({
      purgedCount: 12,
      purgedRawTraceCount: 9,
      purgedGeneratedCandidateCount: 3,
      purgedWatchSearchEventCount: 0,
      purgedQueryEmbeddingCacheCount: 0,
      purgedSeoEvidenceObservationCount: 1,
      purgedSeoTicketOutboxAttemptCount: 2,
      purgedSeoApprovalNonceCount: 3,
      purgedSeoWorkloadAssertionCount: 4,
      purgedSeoLessonCount: 5,
      redactedSeoProposalVersionCount: 6,
      redactedSeoDecisionCount: 7,
      redactedSeoExperimentCount: 8,
      purgedBefore: "2026-05-30T00:00:00.000Z",
      redactedBefore: "2019-05-30T00:00:00.000Z",
    })
    const { runSearchTraceRetentionJob } = await import("./job")

    await runSearchTraceRetentionJob({
      trigger: "scheduled",
      ledgerRunId: "ledger-run-1",
    })

    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-run-1" },
      data: expect.objectContaining({
        status: "RUNNING",
        startedAt: expect.any(Date),
      }),
    })
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-run-1" },
      data: expect.objectContaining({
        status: "SUCCEEDED",
        summary: "Purged 12 expired search trace artifact(s).",
        finishedAt: expect.any(Date),
        durationMs: expect.any(Number),
        details: {
          purgedCount: 12,
          purgedRawTraceCount: 9,
          purgedGeneratedCandidateCount: 3,
          purgedWatchSearchEventCount: 0,
          purgedQueryEmbeddingCacheCount: 0,
          purgedSeoEvidenceObservationCount: 1,
          purgedSeoTicketOutboxAttemptCount: 2,
          purgedSeoApprovalNonceCount: 3,
          purgedSeoWorkloadAssertionCount: 4,
          purgedSeoLessonCount: 5,
          redactedSeoProposalVersionCount: 6,
          redactedSeoDecisionCount: 7,
          redactedSeoExperimentCount: 8,
          purgedBefore: "2026-05-30T00:00:00.000Z",
          redactedBefore: "2019-05-30T00:00:00.000Z",
        },
      }),
    })
    expect(JSON.stringify(workflowRun.update.mock.calls)).not.toMatch(
      /queryText|query_text|Jesus film/i,
    )
  })

  it("marks the ledger failed when purge throws", async () => {
    purgeExpiredSearchTraces.mockRejectedValueOnce(new Error("db unavailable"))
    const { runSearchTraceRetentionJob } = await import("./job")

    await expect(
      runSearchTraceRetentionJob({
        trigger: "scheduled",
        ledgerRunId: "ledger-run-1",
      }),
    ).rejects.toThrow("db unavailable")
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-run-1" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "db unavailable",
      }),
    })
  })
})
