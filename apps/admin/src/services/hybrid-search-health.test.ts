import { beforeEach, describe, expect, it } from "vitest"

import {
  __resetSearchHealthForTest,
  getStats,
  recordAttempt,
  recordFailure,
  withTimeout,
} from "./hybrid-search-health"

describe("hybrid-search-health", () => {
  beforeEach(() => {
    __resetSearchHealthForTest()
  })

  it("increments counters on attempt and failure", () => {
    recordAttempt()
    recordAttempt()
    recordFailure(new Error("boom"))

    const stats = getStats()
    expect(stats.attempts).toBe(2)
    expect(stats.failures).toBe(1)
    expect(stats.lastErrorMessage).toBe("boom")
    expect(stats.lastErrorClass).toBe("Error")
    expect(stats.lastErrorAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    )
  })

  it("getStats returns a snapshot, not a live reference", () => {
    recordAttempt()
    const snapshot = getStats()
    snapshot.attempts = 999
    snapshot.failures = 999
    snapshot.lastErrorMessage = "mutated"

    const fresh = getStats()
    expect(fresh.attempts).toBe(1)
    expect(fresh.failures).toBe(0)
    expect(fresh.lastErrorMessage).toBeNull()
  })

  it("captures Error subclass constructor name", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message)
        this.name = "CustomError"
      }
    }
    recordFailure(new CustomError("nope"))
    const stats = getStats()
    expect(stats.lastErrorClass).toBe("CustomError")
    expect(stats.lastErrorMessage).toBe("nope")
  })

  it("captures non-Error throws as UnknownError with String(error) message", () => {
    recordFailure("string-error")
    const stats = getStats()
    expect(stats.lastErrorClass).toBe("UnknownError")
    expect(stats.lastErrorMessage).toBe("string-error")
  })

  it("__resetSearchHealthForTest resets all counters and last-error fields", () => {
    recordAttempt()
    recordAttempt()
    recordFailure(new Error("bad"))

    __resetSearchHealthForTest()

    const stats = getStats()
    expect(stats).toEqual({
      attempts: 0,
      failures: 0,
      lastErrorMessage: null,
      lastErrorClass: null,
      lastErrorAt: null,
    })
  })

  it("withTimeout rejects when the inner promise is slow", async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("too-late"), 100)
    })
    await expect(withTimeout(slow, 10)).rejects.toThrow("Timed out after 10ms")
  })

  it("withTimeout resolves when the inner promise wins", async () => {
    const fast = Promise.resolve("ok")
    await expect(withTimeout(fast, 1000)).resolves.toBe("ok")
  })

  it("withTimeout propagates inner rejection", async () => {
    const failing = Promise.reject(new Error("inner-fail"))
    await expect(withTimeout(failing, 1000)).rejects.toThrow("inner-fail")
  })
})
