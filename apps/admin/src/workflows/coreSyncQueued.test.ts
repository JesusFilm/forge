import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  observe: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  sleep: vi.fn(),
}))
vi.mock("workflow", () => ({ sleep: mocks.sleep }))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/core-sync/job", () => ({
  startCoreSyncJob: mocks.start,
  finishCoreSyncJob: mocks.finish,
  failCoreSyncJob: mocks.fail,
}))
vi.mock("@/services/core-sync/phase-execution", () => ({
  observeCoreSyncPhase: mocks.observe,
}))
import { runCoreSyncQueued } from "./coreSyncQueued"

describe("bounded Core sync Workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })
  it("sleeps between short status checks and preserves ordered phase results", async () => {
    const start = { skipped: false, scope: ["videos", "video-dubs"] }
    const videos = { phase: "videos", errors: 0, updated: 25 }
    const dubs = { phase: "video-dubs", errors: 0, updated: 100 }
    mocks.start.mockResolvedValue(start)
    mocks.observe
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(videos)
      .mockResolvedValueOnce(dubs)
    mocks.finish.mockResolvedValue({ phases: [videos, dubs] })
    await expect(runCoreSyncQueued({ incremental: false })).resolves.toEqual({
      phases: [videos, dubs],
    })
    expect(mocks.sleep).toHaveBeenCalledTimes(2)
    expect(mocks.sleep).toHaveBeenCalledWith("10s")
    expect(mocks.finish).toHaveBeenCalledWith(start, [videos, dubs])
  })
  it("releases the run through the failure handler if the phase worker reports failure", async () => {
    const start = { skipped: false, scope: ["videos", "video-dubs"] }
    mocks.start.mockResolvedValue(start)
    mocks.observe.mockRejectedValue(new Error("worker restart limit"))
    await expect(runCoreSyncQueued()).rejects.toThrow("worker restart limit")
    expect(mocks.fail).toHaveBeenCalledWith(start, "worker restart limit")
    expect(mocks.observe).toHaveBeenCalledTimes(1)
    expect(mocks.finish).not.toHaveBeenCalled()
  })
  it("does not enqueue phase work for a lock-skipped import", async () => {
    mocks.start.mockResolvedValue({ skipped: true, result: { skipped: true } })
    await expect(runCoreSyncQueued()).resolves.toEqual({ skipped: true })
    expect(mocks.observe).not.toHaveBeenCalled()
  })
})
