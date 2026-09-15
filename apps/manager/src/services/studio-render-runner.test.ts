import { expect, it, vi } from "vitest"
import {
  runStudioRenderJob,
  StudioRenderRetentionError,
  type StudioRenderRunPort,
} from "./studio-render-runner"
import { STUDIO_RENDER_PROFILE } from "@forge/studio-contracts/render"
const result = { assets: [], costMicros: null, diagnostic: "fixture" }
function fixture() {
  const port: StudioRenderRunPort = {
    enqueue: vi.fn(async () => {}),
    claim: vi.fn<StudioRenderRunPort["claim"]>(async () => ({
      execute: true,
      leaseId: "lease",
      expiresAt: Date.now() + STUDIO_RENDER_PROFILE.leaseMs,
    })),
    prepare: vi.fn(async () => ({
      execute: async () => ({ retain: async () => result }),
    })),
    owns: vi.fn(async () => true),
    finish: vi.fn(async () => ({ admitted: true })),
  }
  return port
}
it("claims before preparing and durably finishes retained output", async () => {
  const port = fixture()
  await runStudioRenderJob("attempt", port, new AbortController().signal)
  expect(port.claim).toHaveBeenCalledOnce()
  expect(port.finish).toHaveBeenCalledWith(
    "attempt",
    "lease",
    "SUCCEEDED",
    result,
    expect.any(AbortSignal),
  )
})
it("does not dispatch an observed claim", async () => {
  const port = fixture()
  port.claim = vi.fn<StudioRenderRunPort["claim"]>(async () => ({
    execute: false,
    leaseId: null,
  }))
  await runStudioRenderJob("attempt", port, new AbortController().signal)
  expect(port.prepare).not.toHaveBeenCalled()
  expect(port.finish).not.toHaveBeenCalled()
})
it("retains completed output and records a losing result after cancellation", async () => {
  const port = fixture()
  port.owns = vi.fn(async () => false)
  const retain = vi.fn(async () => result)
  port.prepare = vi.fn(async () => ({ execute: async () => ({ retain }) }))
  await runStudioRenderJob("attempt", port, new AbortController().signal)
  expect(retain).toHaveBeenCalledOnce()
  expect(port.finish).toHaveBeenCalledWith(
    "attempt",
    "lease",
    "SUCCEEDED",
    result,
    expect.any(AbortSignal),
  )
})
it("aborts execution when the durable lease is lost", async () => {
  vi.useFakeTimers()
  try {
    const port = fixture()
    let executionSignal: AbortSignal | undefined
    port.prepare = async () => ({
      execute: async (signal) => {
        executionSignal = signal
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        )
        throw new Error("unreachable")
      },
    })
    const pending = runStudioRenderJob(
      "attempt",
      port,
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(1)
    port.owns = async () => false
    await vi.advanceTimersByTimeAsync(2000)
    await pending
    expect(executionSignal?.aborted).toBe(true)
    expect(port.finish).toHaveBeenCalledWith(
      "attempt",
      "lease",
      "CANCELLED",
      expect.objectContaining({ assets: [] }),
      expect.any(AbortSignal),
    )
  } finally {
    vi.useRealTimers()
  }
})

it("reserves terminal recording time when retention expires after partial registration", async () => {
  vi.useFakeTimers()
  try {
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), ms)
      return controller.signal
    })
    const port = fixture(),
      partial = {
        assets: [
          { assetId: "partial", versionId: "version", digest: "a".repeat(64) },
        ],
        costMicros: null,
        diagnostic: "Partial output retained",
      }
    port.prepare = async () => ({
      execute: async () => ({
        retain: async (signal) => {
          await new Promise<void>((done) =>
            signal.addEventListener("abort", () => done(), { once: true }),
          )
          throw new StudioRenderRetentionError(partial)
        },
      }),
    })
    port.finish = vi.fn(async (_id, _lease, _status, record, signal) => {
      expect(record).toEqual(partial)
      expect(signal.aborted).toBe(false)
      return { admitted: true }
    })
    const run = runStudioRenderJob(
      "attempt",
      port,
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(STUDIO_RENDER_PROFILE.retentionMs)
    await run
    expect(port.finish).toHaveBeenCalledOnce()
  } finally {
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
}, 5000)
