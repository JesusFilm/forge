import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CoreSyncJobResult } from "@/services/core-sync/job"

const job = vi.hoisted(() => ({
  startCoreSyncJob: vi.fn(),
  runCoreSyncPhaseJob: vi.fn(),
  finishCoreSyncJob: vi.fn(),
  failCoreSyncJob: vi.fn(),
}))

vi.mock("@/services/core-sync/job", () => job)

describe("runCoreSync workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("runs requested Core sync phases as separate workflow steps", async () => {
    const started = {
      skipped: false,
      run: {
        runId: "sync-1",
        incremental: true,
        phasesToRun: ["languages", "videos"],
        startedAtMs: 100,
      },
      scope: ["languages", "videos"],
      incremental: true,
      trigger: "scheduled",
    } as const
    const languagePhase = {
      phase: "languages",
      created: 1,
      updated: 0,
      softDeleted: 0,
      errors: 0,
      durationMs: 10,
    }
    const videoPhase = {
      phase: "videos",
      created: 0,
      updated: 2,
      softDeleted: 0,
      errors: 0,
      durationMs: 20,
    }
    const result = {
      incremental: true,
      phases: [languagePhase, videoPhase],
      durationMs: 30,
      scope: ["languages", "videos"],
      trigger: "scheduled",
    } satisfies CoreSyncJobResult
    job.startCoreSyncJob.mockResolvedValueOnce(started)
    job.runCoreSyncPhaseJob
      .mockResolvedValueOnce(languagePhase)
      .mockResolvedValueOnce(videoPhase)
    job.finishCoreSyncJob.mockResolvedValueOnce(result)
    const { runCoreSync } = await import("./coreSync")

    await expect(
      runCoreSync({
        scope: ["languages", "videos"],
        trigger: "scheduled",
        incremental: true,
      }),
    ).resolves.toEqual(result)
    expect(job.startCoreSyncJob).toHaveBeenCalledWith({
      scope: ["languages", "videos"],
      trigger: "scheduled",
      incremental: true,
    })
    expect(job.runCoreSyncPhaseJob).toHaveBeenNthCalledWith(
      1,
      started,
      "languages",
    )
    expect(job.runCoreSyncPhaseJob).toHaveBeenNthCalledWith(
      2,
      started,
      "videos",
    )
    expect(job.finishCoreSyncJob).toHaveBeenCalledWith(started, [
      languagePhase,
      videoPhase,
    ])
  })

  it("returns skipped lock-held results without throwing", async () => {
    const result = {
      skipped: true,
      incremental: true,
      phases: [],
      durationMs: 0,
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
    } satisfies CoreSyncJobResult
    job.startCoreSyncJob.mockResolvedValueOnce({ skipped: true, result })
    const { runCoreSync } = await import("./coreSync")

    await expect(runCoreSync({ trigger: "scheduled" })).resolves.toEqual(result)
    expect(job.runCoreSyncPhaseJob).not.toHaveBeenCalled()
    expect(job.finishCoreSyncJob).not.toHaveBeenCalled()
  })

  it("releases the lock and rethrows when a phase step fails", async () => {
    const started = {
      skipped: false,
      run: {
        runId: "sync-1",
        incremental: true,
        phasesToRun: ["languages"],
        startedAtMs: 100,
      },
      scope: ["languages"],
      incremental: true,
      trigger: "manual",
      ledgerRunId: "ledger-run-1",
    } as const
    const error = new Error("lock lost")
    job.startCoreSyncJob.mockResolvedValueOnce(started)
    job.runCoreSyncPhaseJob.mockRejectedValueOnce(error)
    const { runCoreSync } = await import("./coreSync")

    await expect(runCoreSync({ scope: "languages" })).rejects.toBe(error)
    expect(job.failCoreSyncJob).toHaveBeenCalledWith(started, "lock lost")
    expect(job.finishCoreSyncJob).not.toHaveBeenCalled()
  })
})
