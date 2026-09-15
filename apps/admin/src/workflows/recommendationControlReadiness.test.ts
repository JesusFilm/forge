import { beforeEach, describe, expect, it, vi } from "vitest"

const job = vi.hoisted(() => ({
  runRecommendationControlReadinessFromScheduler: vi.fn(),
  markRecommendationControlReadinessSchedulerRuntimeStarted: vi.fn(),
  nextRecommendationControlReadinessRunAt: vi.fn(),
  recordRecommendationControlReadinessSchedulerHeartbeat: vi.fn(),
}))
const proxyJob = vi.hoisted(() => ({
  runPlaybackProxyReadinessFromScheduler: vi.fn(),
}))
const sleep = vi.hoisted(() => vi.fn())
const getWorkflowMetadata = vi.hoisted(() =>
  vi.fn(() => ({ workflowRunId: "runtime-scheduler-1" })),
)
class RetryableError extends Error {}

vi.mock("@/services/recommendations/control-readiness/job", () => job)
vi.mock("@/services/recommendations/proxy-readiness.job", () => proxyJob)
vi.mock("workflow", () => ({ getWorkflowMetadata, RetryableError, sleep }))

describe("recommendation control readiness workflow", () => {
  beforeEach(() => vi.clearAllMocks())

  it("evaluates offline, records the next heartbeat, and sleeps", async () => {
    const next = new Date("2026-08-20T11:00:00.000Z")
    job.runRecommendationControlReadinessFromScheduler.mockResolvedValue({
      ok: true,
      ledgerRunId: "evaluation-ledger-1",
    })
    proxyJob.runPlaybackProxyReadinessFromScheduler.mockResolvedValue({
      ok: true,
      ledgerRunId: "proxy-evaluation-ledger-1",
    })
    job.nextRecommendationControlReadinessRunAt.mockReturnValue(next)
    job.recordRecommendationControlReadinessSchedulerHeartbeat.mockResolvedValue(
      undefined,
    )
    sleep.mockRejectedValue(new Error("stop after one cycle"))
    const { runRecommendationControlReadinessScheduler } =
      await import("./recommendationControlReadiness")

    await expect(
      runRecommendationControlReadinessScheduler({
        ledgerRunId: "scheduler-ledger-1",
      }),
    ).rejects.toThrow("stop after one cycle")
    expect(
      job.markRecommendationControlReadinessSchedulerRuntimeStarted,
    ).toHaveBeenCalledWith("scheduler-ledger-1", "runtime-scheduler-1")
    expect(
      job.markRecommendationControlReadinessSchedulerRuntimeStarted.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      job.runRecommendationControlReadinessFromScheduler.mock
        .invocationCallOrder[0]!,
    )
    expect(
      job.runRecommendationControlReadinessFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(
      proxyJob.runPlaybackProxyReadinessFromScheduler,
    ).toHaveBeenCalledOnce()
    expect(
      job.recordRecommendationControlReadinessSchedulerHeartbeat,
    ).toHaveBeenCalledWith("scheduler-ledger-1", next)
    expect(sleep).toHaveBeenCalledWith(next)
  })
})
