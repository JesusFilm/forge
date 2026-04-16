import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetSearchHealthForTest,
  getStats,
  recordAttempt,
  recordFailure,
  withTimeout,
} from "./search-health"

beforeEach(() => {
  __resetSearchHealthForTest()
})

describe("recordAttempt", () => {
  it("increments attempts without touching failures", () => {
    recordAttempt()
    recordAttempt()

    const stats = getStats()
    expect(stats.attempts).toBe(2)
    expect(stats.failures).toBe(0)
    expect(stats.lastErrorMessage).toBeNull()
    expect(stats.lastErrorClass).toBeNull()
    expect(stats.lastErrorAt).toBeNull()
  })
})

describe("recordFailure", () => {
  it("increments failures and captures Error instance details", () => {
    const before = new Date().toISOString()
    recordFailure(new TypeError("thing blew up"))

    const stats = getStats()
    expect(stats.failures).toBe(1)
    expect(stats.lastErrorMessage).toBe("thing blew up")
    expect(stats.lastErrorClass).toBe("TypeError")
    // lastErrorAt should be a parseable ISO timestamp at or after `before`.
    expect(stats.lastErrorAt).not.toBeNull()
    expect(new Date(stats.lastErrorAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    )
  })

  it("captures non-Error thrown values as UnknownError", () => {
    recordFailure("raw string error")

    const stats = getStats()
    expect(stats.failures).toBe(1)
    expect(stats.lastErrorMessage).toBe("raw string error")
    expect(stats.lastErrorClass).toBe("UnknownError")
  })

  it("does not touch attempts counter (caller is responsible for recordAttempt)", () => {
    recordFailure(new Error("boom"))

    expect(getStats().attempts).toBe(0)
  })

  it("overwrites last-error details with the most recent failure", () => {
    recordFailure(new Error("first"))
    recordFailure(new RangeError("second"))

    const stats = getStats()
    expect(stats.failures).toBe(2)
    expect(stats.lastErrorMessage).toBe("second")
    expect(stats.lastErrorClass).toBe("RangeError")
  })
})

describe("getStats", () => {
  it("returns a snapshot, not a live reference", () => {
    recordAttempt()
    const snapshot = getStats()

    recordAttempt()

    expect(snapshot.attempts).toBe(1)
    expect(getStats().attempts).toBe(2)
  })
})

describe("withTimeout", () => {
  it("resolves with the underlying promise's value when it settles in time", async () => {
    const result = await withTimeout(Promise.resolve("done"), 100)
    expect(result).toBe("done")
  })

  it("rejects with a timeout error when the underlying promise stalls", async () => {
    vi.useFakeTimers()
    try {
      const hung = new Promise<string>(() => {
        // intentionally never resolves
      })
      // Attach the rejection handler BEFORE advancing timers so the
      // rejection is never momentarily unhandled (which would surface as
      // a PromiseRejectionHandledWarning under Node 24).
      const assertion = expect(withTimeout(hung, 5000)).rejects.toThrow(
        /Timed out after 5000ms/,
      )
      await vi.advanceTimersByTimeAsync(5001)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it("propagates the underlying rejection rather than a timeout error", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("upstream failure")), 100),
    ).rejects.toThrow("upstream failure")
  })

  it("cleans up the timer after early resolution (no spurious rejection)", async () => {
    vi.useFakeTimers()
    try {
      // Resolve immediately — the clearTimeout path in the resolve handler
      // must prevent the dangling setTimeout from firing a spurious timeout
      // rejection after the promise has already settled.
      const result = await withTimeout(Promise.resolve("fast"), 5000)
      expect(result).toBe("fast")

      // Advance past the timeout window. If clearTimeout failed, this would
      // surface an unhandled rejection.
      await vi.advanceTimersByTimeAsync(6000)
    } finally {
      vi.useRealTimers()
    }
  })
})
