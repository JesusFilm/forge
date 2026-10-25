import { beforeEach, describe, expect, it, vi } from "vitest"

const job = vi.hoisted(() => ({
  runSearchTraceRetentionJob: vi.fn(),
}))

vi.mock("@/services/search-trace-retention/job", () => job)

describe("runSearchTraceRetention workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("runs raw search trace purge as a workflow step", async () => {
    const result = {
      purgedCount: 5,
      purgedRawTraceCount: 3,
      purgedGeneratedCandidateCount: 2,
      purgedWatchSearchEventCount: 0,
      purgedQueryEmbeddingCacheCount: 0,
      purgedBefore: "2026-05-30T00:00:00.000Z",
    }
    job.runSearchTraceRetentionJob.mockResolvedValueOnce(result)
    const { runSearchTraceRetention } = await import("./searchTraceRetention")

    await expect(
      runSearchTraceRetention({
        trigger: "scheduled",
        ledgerRunId: "workflow-run-1",
      }),
    ).resolves.toEqual(result)
    expect(job.runSearchTraceRetentionJob).toHaveBeenCalledWith({
      trigger: "scheduled",
      ledgerRunId: "workflow-run-1",
    })
  })
})
