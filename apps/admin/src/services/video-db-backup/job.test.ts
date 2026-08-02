import { beforeEach, describe, expect, it, vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const start = vi.hoisted(() => vi.fn())
const workflowRun = vi.hoisted(() => ({
  create: vi.fn(async (args) => ({ id: "ledger-run-1", ...args.data })),
  findFirst: vi.fn(),
  update: vi.fn(async (args) => args),
}))
const queryRaw = vi.hoisted(() => vi.fn())
const backup = vi.hoisted(() => ({
  SCHEDULED_VIDEO_DB_BACKUP_PROFILES: ["video-core", "video-search"] as const,
  runScheduledVideoDbBackup: vi.fn(),
}))

vi.mock("workflow/api", () => ({ start }))
vi.mock("@/db/client", () => ({ prisma: { $queryRaw: queryRaw, workflowRun } }))
vi.mock("@/scripts/video-db-backup", () => backup)

describe("video DB backup workflow job", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryRaw.mockResolvedValue([{ locked: true }])
    workflowRun.findFirst.mockResolvedValue(null)
  })

  it("calculates the next daily UTC backup time", async () => {
    const { nextVideoDbBackupRunAt } = await import("./job")

    expect(
      nextVideoDbBackupRunAt(new Date("2026-05-14T08:59:00.000Z")),
    ).toEqual(new Date("2026-05-14T09:00:00.000Z"))
    expect(
      nextVideoDbBackupRunAt(new Date("2026-05-14T09:00:00.000Z")),
    ).toEqual(new Date("2026-05-15T09:00:00.000Z"))
  })

  it("starts one durable scheduler workflow when none is running", async () => {
    start.mockResolvedValueOnce({
      runId: "scheduler-runtime-run-1",
      returnValue: Promise.resolve(undefined),
    })
    const { ensureVideoDbBackupSchedulerStarted } = await import("./job")
    const { runVideoDbBackupScheduler } =
      await import("@/workflows/videoDbBackup")

    await expect(ensureVideoDbBackupSchedulerStarted()).resolves.toEqual({
      started: true,
      runId: "scheduler-runtime-run-1",
      ledgerRunId: "ledger-run-1",
    })
    expect(workflowRun.findFirst).toHaveBeenCalledWith({
      where: {
        workflowKey: "video-db-backup-scheduler",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    })
    expect(start).toHaveBeenCalledWith(runVideoDbBackupScheduler, [
      { ledgerRunId: "ledger-run-1" },
    ])
  })

  it("does not start a duplicate scheduler when one is already active", async () => {
    workflowRun.findFirst.mockResolvedValueOnce({
      id: "existing-ledger-run",
      runtimeRunId: "existing-runtime-run",
    })
    const { ensureVideoDbBackupSchedulerStarted } = await import("./job")

    await expect(ensureVideoDbBackupSchedulerStarted()).resolves.toEqual({
      started: false,
      reason: "already-running",
      ledgerRunId: "existing-ledger-run",
      runtimeRunId: "existing-runtime-run",
    })
    expect(start).not.toHaveBeenCalled()
  })

  it("replaces a stale scheduler ledger row when the runtime run already failed", async () => {
    queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([
        { status: "failed", error: "Workflow was not registered." },
      ])
      .mockResolvedValueOnce([{ unlocked: true }])
    workflowRun.findFirst.mockResolvedValueOnce({
      id: "stale-ledger-run",
      runtimeRunId: "failed-runtime-run",
    })
    start.mockResolvedValueOnce({
      runId: "scheduler-runtime-run-2",
      returnValue: Promise.resolve(undefined),
    })
    const { ensureVideoDbBackupSchedulerStarted } = await import("./job")

    await expect(ensureVideoDbBackupSchedulerStarted()).resolves.toEqual({
      started: true,
      runId: "scheduler-runtime-run-2",
      ledgerRunId: "ledger-run-1",
    })
    expect(workflowRun.update).toHaveBeenCalledWith({
      where: { id: "stale-ledger-run" },
      data: expect.objectContaining({
        status: "FAILED",
        summary: "Video DB backup scheduler runtime failed.",
        error: "Workflow was not registered.",
        finishedAt: expect.any(Date),
      }),
    })
    expect(start).toHaveBeenCalledOnce()
  })

  it("dispatches the scheduled backup through useworkflow", async () => {
    const dispatch = wrapStartSpy(start)
    start.mockResolvedValueOnce({
      runId: "runtime-run-1",
      returnValue: Promise.resolve(undefined),
    })
    const { dispatchVideoDbBackup } = await import("./job")
    const { runVideoDbBackup } = await import("@/workflows/videoDbBackup")

    await expect(
      dispatchVideoDbBackup({ trigger: "scheduled", profile: "video-search" }),
    ).resolves.toEqual({
      workflow: "video-db-backup",
      runId: "runtime-run-1",
      trigger: "scheduled",
      status: "queued",
    })
    dispatch.expectDispatched(runVideoDbBackup, [
      {
        trigger: "scheduled",
        ledgerRunId: "ledger-run-1",
        profile: "video-search",
      },
    ])
    expect(workflowRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowKey: "video-db-backup",
        workflowName: "Video DB Backup",
        trigger: "SCHEDULED",
        subjectType: "database",
        subjectId: "admin-video",
        details: expect.objectContaining({
          profile: "video-search",
        }),
      }),
    })
  })

  it("marks the ledger run succeeded after backup completes", async () => {
    backup.runScheduledVideoDbBackup.mockResolvedValueOnce({
      event: "video-db.backup.complete",
      profile: "video-core",
      tables: 22,
      path: "/tmp/video.dump",
      size: 12_345,
      exportDurationMs: 4_000,
      uploadDurationMs: 1_500,
      upload: {
        bucket: "admin-storage",
        key: "admin-video-db-backups/video-core/video.dump",
      },
    })
    const { runVideoDbBackupJob } = await import("./job")

    await runVideoDbBackupJob({
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
        summary: expect.stringContaining("Backed up 22 table"),
        finishedAt: expect.any(Date),
        durationMs: expect.any(Number),
        details: {
          result: expect.objectContaining({
            size: 12_345,
            exportDurationMs: 4_000,
            uploadDurationMs: 1_500,
          }),
        },
      }),
    })
  })

  it("runs catalog and search snapshots from the scheduler", async () => {
    workflowRun.create
      .mockResolvedValueOnce({ id: "ledger-core" })
      .mockResolvedValueOnce({ id: "ledger-search" })
    backup.runScheduledVideoDbBackup
      .mockResolvedValueOnce({
        event: "video-db.backup.complete",
        profile: "video-core",
        tables: 22,
        path: "/tmp/video-core.dump",
        upload: {
          bucket: "admin-storage",
          key: "admin-video-db-backups/video-core/video.dump",
        },
      })
      .mockResolvedValueOnce({
        event: "video-db.backup.complete",
        profile: "video-search",
        tables: 26,
        path: "/tmp/video-search.dump",
        upload: {
          bucket: "admin-storage",
          key: "admin-video-db-backups/video-search/video.dump",
        },
      })
    const { runVideoDbBackupFromScheduler } = await import("./job")

    await expect(runVideoDbBackupFromScheduler()).resolves.toEqual([
      expect.objectContaining({
        ok: true,
        ledgerRunId: "ledger-core",
        result: expect.objectContaining({ profile: "video-core" }),
      }),
      expect.objectContaining({
        ok: true,
        ledgerRunId: "ledger-search",
        result: expect.objectContaining({ profile: "video-search" }),
      }),
    ])

    expect(workflowRun.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({ profile: "video-core" }),
        }),
      }),
    )
    expect(workflowRun.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.objectContaining({ profile: "video-search" }),
        }),
      }),
    )
    expect(backup.runScheduledVideoDbBackup).toHaveBeenNthCalledWith(
      1,
      "video-core",
    )
    expect(backup.runScheduledVideoDbBackup).toHaveBeenNthCalledWith(
      2,
      "video-search",
    )
  })
})
