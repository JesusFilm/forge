import { beforeEach, describe, expect, it, vi } from "vitest"

const snapshotJob = vi.hoisted(() => ({
  runPlaybackObservationSnapshotFromScheduler: vi.fn(),
}))
const readinessJob = vi.hoisted(() => ({
  runPlaybackSignalReadinessFromScheduler: vi.fn(),
}))
const ledger = vi.hoisted(() => ({
  markWorkflowRunStarted: vi.fn(),
  markWorkflowRunFailed: vi.fn(),
}))
const update = vi.hoisted(() => vi.fn())

class RetryableError extends Error {}
vi.mock("workflow", () => ({ RetryableError }))
vi.mock(
  "@/services/recommendations/playback-observation-snapshot.job",
  () => snapshotJob,
)
vi.mock(
  "@/services/recommendations/playback-signal-readiness.job",
  () => readinessJob,
)
vi.mock("@/services/workflow-run-log.service", () => ledger)
vi.mock("@/db/client", () => ({ prisma: { workflowRun: { update } } }))

describe("playback observation bootstrap workflow", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps the root ledger active until both child jobs complete", async () => {
    snapshotJob.runPlaybackObservationSnapshotFromScheduler.mockResolvedValue({
      ok: true,
      ledgerRunId: "snapshot-child",
    })
    readinessJob.runPlaybackSignalReadinessFromScheduler.mockResolvedValue({
      ok: true,
      ledgerRunId: "readiness-child",
    })
    const { runPlaybackObservationSnapshotBootstrap } =
      await import("./playbackObservationSnapshotBootstrap")

    await runPlaybackObservationSnapshotBootstrap({ ledgerRunId: "root" })

    expect(ledger.markWorkflowRunStarted).toHaveBeenCalledWith("root")
    expect(
      snapshotJob.runPlaybackObservationSnapshotFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(
      readinessJob.runPlaybackSignalReadinessFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "root" },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    )
    expect(
      readinessJob.runPlaybackSignalReadinessFromScheduler.mock
        .invocationCallOrder[0],
    ).toBeLessThan(update.mock.invocationCallOrder[0]!)
  })

  it("still evaluates readiness when snapshot retries are exhausted", async () => {
    snapshotJob.runPlaybackObservationSnapshotFromScheduler.mockResolvedValue({
      ok: false,
      ledgerRunId: "snapshot-child",
    })
    readinessJob.runPlaybackSignalReadinessFromScheduler.mockResolvedValue({
      ok: true,
      ledgerRunId: "readiness-child",
    })
    const { runPlaybackObservationSnapshotBootstrap } =
      await import("./playbackObservationSnapshotBootstrap")

    await expect(
      runPlaybackObservationSnapshotBootstrap({ ledgerRunId: "root" }),
    ).rejects.toThrow("Playback observation bootstrap incomplete")
    expect(
      readinessJob.runPlaybackSignalReadinessFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(ledger.markWorkflowRunFailed).toHaveBeenCalledWith(
      "root",
      expect.any(Error),
    )
    expect(update).not.toHaveBeenCalled()
  })
})
