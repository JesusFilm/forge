import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import type { CoverageAudit } from "@/services/core-sync/coverage-audit"
import type { SyncResult } from "@/services/core-sync/orchestrator"
import { runCoreSync } from "@/workflows/coreSync"

const syncPrisma = vi.hoisted(() => ({ name: "sync-prisma" }))
const runSync = vi.hoisted(() => vi.fn())
const runSyncPhase = vi.hoisted(() => vi.fn())
const start = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(async (args) => args),
}))
const queryRaw = vi.hoisted(() => vi.fn())
const workflowRunLog = vi.hoisted(() => ({
  createWorkflowRunLog: vi.fn(),
  attachWorkflowRuntimeRunId: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
  markWorkflowRunStarted: vi.fn(),
  recordCoreSyncPhaseProgress: vi.fn(),
  recordCoreSyncRunResult: vi.fn(),
}))

function clearCoreSyncSchedulerState() {
  const schedulerGlobal = globalThis as typeof globalThis & {
    __forgeAdminCoreSyncScheduler?: {
      timer: ReturnType<typeof setTimeout> | null
    }
  }
  if (schedulerGlobal.__forgeAdminCoreSyncScheduler?.timer) {
    clearTimeout(schedulerGlobal.__forgeAdminCoreSyncScheduler.timer)
  }
  delete schedulerGlobal.__forgeAdminCoreSyncScheduler
}

vi.mock("@/db/client", () => ({
  prisma: { $queryRaw: queryRaw, workflowRun },
  syncPrisma,
}))
vi.mock("workflow/api", () => ({ start }))
vi.mock("@/services/workflow-run-log.service", () => workflowRunLog)
vi.mock("@/services/core-sync/orchestrator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/core-sync/orchestrator")>()
  return {
    ...actual,
    runSync,
    runSyncPhase,
  }
})

describe("core sync job", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-13T05:55:00.000Z"))
    vi.clearAllMocks()
    clearCoreSyncSchedulerState()
    workflowRunLog.createWorkflowRunLog.mockResolvedValue({
      id: "ledger-run-1",
    })
    workflowRunLog.attachWorkflowRuntimeRunId.mockResolvedValue(undefined)
    workflowRunLog.markWorkflowRunFailed.mockResolvedValue(undefined)
    workflowRunLog.markWorkflowRunStarted.mockResolvedValue(undefined)
    workflowRunLog.recordCoreSyncPhaseProgress.mockResolvedValue(undefined)
    workflowRunLog.recordCoreSyncRunResult.mockResolvedValue(undefined)
    workflowRun.findFirst.mockResolvedValue(null)
    queryRaw.mockResolvedValue([{ locked: true }])
  })

  afterEach(() => {
    clearCoreSyncSchedulerState()
    vi.useRealTimers()
  })

  it("normalizes scheduled input to incremental all-phase sync", async () => {
    const { normalizeCoreSyncInput } = await import("./job")

    expect(normalizeCoreSyncInput({ trigger: "scheduled" })).toEqual({
      scope: [
        "languages",
        "countries",
        "keywords",
        "video-origins",
        "videos",
        "video-images",
        "video-editions",
        "video-subtitles",
        "video-dubs",
        "video-dub-downloads",
      ],
      incremental: true,
      trigger: "scheduled",
    })
  })

  it("preserves manual full-sync scope", async () => {
    const { normalizeCoreSyncInput } = await import("./job")

    expect(
      normalizeCoreSyncInput({
        scope: ["languages", "videos"],
        incremental: false,
        trigger: "manual",
      }),
    ).toEqual({
      scope: ["languages", "videos"],
      incremental: false,
      trigger: "manual",
    })
  })

  it("runs the orchestrator with syncPrisma and normalized input", async () => {
    const result = {
      incremental: false,
      phases: [],
      durationMs: 42,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(
      runCoreSyncJob({
        scope: "languages",
        incremental: false,
        trigger: "graphql",
        ledgerRunId: "ledger-run-1",
      }),
    ).resolves.toEqual({
      ...result,
      scope: ["languages"],
      trigger: "graphql",
    })
    expect(runSync).toHaveBeenCalledWith(
      syncPrisma as unknown as PrismaClient,
      {
        scope: ["languages"],
        incremental: false,
      },
    )
    expect(workflowRunLog.markWorkflowRunStarted).toHaveBeenCalledWith(
      "ledger-run-1",
    )
    expect(workflowRunLog.recordCoreSyncRunResult).toHaveBeenCalledWith(
      "ledger-run-1",
      result,
    )
  })

  it("dispatches the Core sync workflow without awaiting the run result", async () => {
    const returnValue = Promise.resolve({
      incremental: true,
      phases: [],
      durationMs: 100,
      scope: ["languages"],
      trigger: "manual",
    })
    start.mockResolvedValueOnce({ runId: "run-core-sync-1", returnValue })
    const { dispatchCoreSync } = await import("./job")

    await expect(
      dispatchCoreSync({
        scope: "languages",
        incremental: true,
        trigger: "manual",
      }),
    ).resolves.toEqual({
      workflow: "core-sync",
      runId: "run-core-sync-1",
      scope: ["languages"],
      incremental: true,
      trigger: "manual",
      status: "queued",
    })
    expect(start).toHaveBeenCalledWith(runCoreSync, [
      {
        scope: ["languages"],
        incremental: true,
        trigger: "manual",
        ledgerRunId: "ledger-run-1",
      },
    ])
    expect(workflowRunLog.createWorkflowRunLog).toHaveBeenCalledWith({
      workflowKey: "core-sync",
      workflowName: "Core Sync",
      trigger: "manual",
      subjectType: "sync",
      subjectId: "core",
      summary: "Core Sync workflow queued.",
      details: {
        scope: ["languages"],
        incremental: true,
      },
    })
    expect(workflowRunLog.attachWorkflowRuntimeRunId).toHaveBeenCalledWith(
      "ledger-run-1",
      "run-core-sync-1",
    )
  })

  it("calculates the next daily UTC Core Sync time", async () => {
    const { nextCoreSyncRunAt } = await import("./job")

    expect(nextCoreSyncRunAt(new Date("2026-08-13T06:59:00.000Z"))).toEqual(
      new Date("2026-08-13T07:00:00.000Z"),
    )
    expect(nextCoreSyncRunAt(new Date("2026-08-13T07:00:00.000Z"))).toEqual(
      new Date("2026-08-14T07:00:00.000Z"),
    )
  })

  it("starts one DB-ledgered Core Sync scheduler timer when none is running", async () => {
    const { ensureCoreSyncSchedulerStarted } = await import("./job")

    await expect(ensureCoreSyncSchedulerStarted()).resolves.toEqual({
      started: true,
      ledgerRunId: "ledger-run-1",
      nextRunAt: "2026-08-13T07:00:00.000Z",
    })
    expect(workflowRun.findFirst).toHaveBeenCalledWith({
      where: {
        workflowKey: "core-sync-scheduler",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    })
    expect(start).not.toHaveBeenCalled()
    expect(workflowRunLog.markWorkflowRunStarted).toHaveBeenCalledWith(
      "ledger-run-1",
    )
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "ledger-run-1" },
      data: expect.objectContaining({
        summary: "Core Sync scheduler sleeping until 2026-08-13T07:00:00.000Z.",
        details: {
          nextRunAt: "2026-08-13T07:00:00.000Z",
          schedule: "daily 07:00 UTC",
          incremental: true,
        },
      }),
    })
    expect(workflowRunLog.createWorkflowRunLog).toHaveBeenCalledWith({
      workflowKey: "core-sync-scheduler",
      workflowName: "Core Sync Scheduler",
      trigger: "system",
      subjectType: "sync",
      subjectId: "core",
      summary: "Core Sync scheduler queued.",
      details: {
        schedule: "daily 07:00 UTC",
        incremental: true,
      },
    })
  })

  it("does not start a duplicate Core Sync scheduler when one is already active", async () => {
    workflowRun.findFirst.mockResolvedValueOnce({
      id: "existing-ledger-run",
      updatedAt: new Date("2026-08-13T05:54:00.000Z"),
      details: {
        nextRunAt: "2026-08-13T07:00:00.000Z",
      },
    })
    const { ensureCoreSyncSchedulerStarted } = await import("./job")

    await expect(ensureCoreSyncSchedulerStarted()).resolves.toEqual({
      started: false,
      reason: "already-running",
      ledgerRunId: "existing-ledger-run",
      nextRunAt: "2026-08-13T07:00:00.000Z",
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("replaces a stale Core Sync scheduler ledger row", async () => {
    workflowRun.findFirst.mockResolvedValueOnce({
      id: "stale-ledger-run",
      updatedAt: new Date("2026-08-10T05:55:00.000Z"),
      details: {
        nextRunAt: "2026-08-10T07:00:00.000Z",
      },
    })
    const { ensureCoreSyncSchedulerStarted } = await import("./job")

    await expect(ensureCoreSyncSchedulerStarted()).resolves.toEqual({
      started: true,
      ledgerRunId: "ledger-run-1",
      nextRunAt: "2026-08-13T07:00:00.000Z",
    })
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "stale-ledger-run" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "Core Sync scheduler stale; starting a replacement.",
        error: "scheduler_stale",
        finishedAt: expect.any(Date),
      }),
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("scheduler ticks dispatch the registered Core Sync workflow and reschedule", async () => {
    start.mockResolvedValueOnce({
      runId: "run-core-sync-1",
      returnValue: Promise.resolve(undefined),
    })
    const { runCoreSyncSchedulerTick } = await import("./job")

    await runCoreSyncSchedulerTick("scheduler-ledger-run-1")

    expect(start).toHaveBeenCalledWith(runCoreSync, [
      {
        scope: [
          "languages",
          "countries",
          "keywords",
          "video-origins",
          "videos",
          "video-images",
          "video-editions",
          "video-subtitles",
          "video-dubs",
          "video-dub-downloads",
        ],
        incremental: true,
        trigger: "scheduled",
        ledgerRunId: "ledger-run-1",
      },
    ])
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "scheduler-ledger-run-1" },
      data: expect.objectContaining({
        summary: "Core Sync scheduler sleeping until 2026-08-13T07:00:00.000Z.",
      }),
    })
  })

  it("marks the ledger failed when workflow dispatch fails", async () => {
    const boom = new Error("workflow backend unavailable")
    start.mockRejectedValueOnce(boom)
    const { dispatchCoreSync } = await import("./job")

    await expect(dispatchCoreSync({ trigger: "scheduled" })).rejects.toBe(boom)
    expect(workflowRunLog.markWorkflowRunFailed).toHaveBeenCalledWith(
      "ledger-run-1",
      boom,
    )
  })

  it("preserves lock-held skipped results", async () => {
    const result = {
      skipped: true,
      incremental: true,
      phases: [],
      durationMs: 0,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(
      runCoreSyncJob({ trigger: "scheduled" }),
    ).resolves.toMatchObject({
      skipped: true,
      incremental: true,
      scope: [
        "languages",
        "countries",
        "keywords",
        "video-origins",
        "videos",
        "video-images",
        "video-editions",
        "video-subtitles",
        "video-dubs",
        "video-dub-downloads",
      ],
      trigger: "scheduled",
    })
  })

  it("preserves coverage audit result payloads", async () => {
    const coverageAudit = {
      generatedAt: "2026-04-29T00:00:00.000Z",
      status: "pass",
      checks: [],
    } satisfies CoverageAudit
    const result = {
      incremental: true,
      phases: [],
      durationMs: 10,
      coverageAudit,
    } satisfies SyncResult
    runSync.mockResolvedValueOnce(result)
    const { runCoreSyncJob } = await import("./job")

    await expect(runCoreSyncJob()).resolves.toMatchObject({
      coverageAudit,
      trigger: "manual",
    })
  })

  it("records ledger progress for workflow phase jobs", async () => {
    const phaseResult = {
      phase: "videos",
      created: 0,
      updated: 25,
      softDeleted: 0,
      errors: 0,
      durationMs: 100,
    }
    runSyncPhase.mockImplementationOnce(async (_prisma, _run, _phase, opts) => {
      opts.onProgress({
        phase: "videos",
        completed: 25,
        total: 50,
        elapsedMs: 75,
      })
      return phaseResult
    })
    const { runCoreSyncPhaseJob } = await import("./job")

    await expect(
      runCoreSyncPhaseJob(
        {
          skipped: false,
          run: {
            runId: "sync-run-1",
            incremental: true,
            phasesToRun: ["videos"],
            startedAtMs: Date.now(),
          },
          scope: ["videos"],
          incremental: true,
          trigger: "scheduled",
          ledgerRunId: "ledger-run-1",
        },
        "videos",
      ),
    ).resolves.toEqual(phaseResult)

    expect(runSyncPhase).toHaveBeenCalledWith(
      syncPrisma as unknown as PrismaClient,
      expect.objectContaining({ runId: "sync-run-1" }),
      "videos",
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(workflowRunLog.recordCoreSyncPhaseProgress).toHaveBeenCalledWith(
      "ledger-run-1",
      {
        phase: "videos",
        completed: 25,
        total: 50,
        elapsedMs: 75,
      },
    )
  })
})
