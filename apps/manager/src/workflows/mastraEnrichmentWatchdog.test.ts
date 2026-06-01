import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { failMastraEnrichmentIfNoCallbackMock } = vi.hoisted(() => ({
  failMastraEnrichmentIfNoCallbackMock: vi.fn(),
}))

vi.mock("@/lib/state", () => ({
  failMastraEnrichmentIfNoCallback: failMastraEnrichmentIfNoCallbackMock,
}))

import {
  MASTRA_FIRST_CALLBACK_WATCHDOG_MS,
  scheduleMastraFirstCallbackWatchdog,
} from "@/workflows/mastraEnrichmentWatchdog"

describe("scheduleMastraFirstCallbackWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    failMastraEnrichmentIfNoCallbackMock.mockResolvedValue({
      status: "dropped",
      reason: "callback_seen",
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("checks the current job/run after the first-callback window", async () => {
    scheduleMastraFirstCallbackWatchdog("job-1", "run-1")

    expect(failMastraEnrichmentIfNoCallbackMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(MASTRA_FIRST_CALLBACK_WATCHDOG_MS)

    expect(failMastraEnrichmentIfNoCallbackMock).toHaveBeenCalledWith(
      "job-1",
      "run-1",
    )
  })

  it("allows tests to override the watchdog delay", async () => {
    scheduleMastraFirstCallbackWatchdog("job-2", "run-2", { delayMs: 25 })

    await vi.advanceTimersByTimeAsync(24)
    expect(failMastraEnrichmentIfNoCallbackMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(failMastraEnrichmentIfNoCallbackMock).toHaveBeenCalledWith(
      "job-2",
      "run-2",
    )
  })
})
