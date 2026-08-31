import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const runJob = vi.hoisted(() => vi.fn())
const markRuntimeStarted = vi.hoisted(() => vi.fn())
const recover = vi.hoisted(() => vi.fn())
const sleep = vi.hoisted(() => vi.fn())
vi.mock("@/services/recommendations/finalization/job", () => ({
  runRecommendationEpisodeFinalizationJob: runJob,
  markRecommendationEpisodeFinalizationRuntimeStarted: markRuntimeStarted,
  recoverRecommendationEpisodeFinalizations: recover,
}))
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "runtime-1" }),
  sleep,
}))

import {
  runRecommendationEpisodeFinalization,
  runRecommendationEpisodeFinalizationRecovery,
} from "./recommendationEpisodeFinalization"

describe("recommendation episode finalization workflow", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  it("runs the idempotent finalization job as a workflow step", async () => {
    runJob.mockResolvedValue({ status: "existing", revision: 1 })
    const input = {
      episodeId: "episode-1",
      generation: 2,
      reason: "terminal-fact" as const,
      ledgerRunId: "ledger-1",
    }
    await expect(
      runRecommendationEpisodeFinalization(input),
    ).resolves.toMatchObject({ status: "existing" })
    expect(markRuntimeStarted).toHaveBeenCalledWith("ledger-1", "runtime-1")
    expect(markRuntimeStarted).toHaveBeenCalledBefore(runJob)
    expect(runJob).toHaveBeenCalledWith(input)
  })

  it("repairs the recovery runtime identity before its first sweep", async () => {
    recover.mockRejectedValueOnce(new Error("stop after attachment"))

    await expect(
      runRecommendationEpisodeFinalizationRecovery({
        ledgerRunId: "recovery-ledger",
      }),
    ).rejects.toThrow("stop after attachment")
    expect(markRuntimeStarted).toHaveBeenCalledWith(
      "recovery-ledger",
      "runtime-1",
    )
    expect(markRuntimeStarted).toHaveBeenCalledBefore(recover)
  })

  it("sleeps until a future finalization boundary before running the job", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-19T03:00:00.000Z"))
    sleep.mockResolvedValue(undefined)
    runJob.mockResolvedValue({ status: "finalized", revision: 1 })
    const input = {
      episodeId: "episode-future",
      generation: 1,
      reason: "episode-opened" as const,
      ledgerRunId: "ledger-future",
      notBefore: "2026-08-19T03:05:00.000Z",
    }

    await runRecommendationEpisodeFinalization(input)

    expect(sleep).toHaveBeenCalledWith(new Date("2026-08-19T03:05:00.000Z"))
    expect(sleep.mock.invocationCallOrder[0]).toBeLessThan(
      runJob.mock.invocationCallOrder[0]!,
    )
  })

  it.each(["2026-08-19T03:00:00.000Z", "2026-08-19T02:59:59.999Z"])(
    "runs immediately when notBefore is not in the future (%s)",
    async (notBefore) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-08-19T03:00:00.000Z"))
      runJob.mockResolvedValue({ status: "finalized", revision: 1 })

      await runRecommendationEpisodeFinalization({
        episodeId: "episode-immediate",
        generation: 1,
        reason: "episode-opened",
        ledgerRunId: "ledger-immediate",
        notBefore,
      })

      expect(sleep).not.toHaveBeenCalled()
      expect(runJob).toHaveBeenCalledOnce()
    },
  )
})
