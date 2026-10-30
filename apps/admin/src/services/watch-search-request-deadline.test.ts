import { describe, expect, it } from "vitest"
import {
  assertBeforeDeadline,
  beforeDeadline,
  settleBeforeDeadline,
} from "./watch-search-request-deadline"
import { WatchSearchTimeoutError } from "./watch-search.service"

describe("watch search request deadline helpers", () => {
  it("never returns success from an elapsed budget, even for a resolved promise", async () => {
    const elapsed = performance.now() - 1

    await expect(
      settleBeforeDeadline(Promise.resolve("late"), elapsed),
    ).resolves.toMatchObject({ status: "timed_out" })
    await expect(
      beforeDeadline(Promise.resolve("late"), elapsed),
    ).rejects.toBeInstanceOf(WatchSearchTimeoutError)
  })

  it("reports a promise that settles after the deadline as timed out", async () => {
    const atMs = performance.now() + 20
    const late = new Promise((resolve) => setTimeout(resolve, 40, "late"))

    await expect(settleBeforeDeadline(late, atMs)).resolves.toMatchObject({
      status: "timed_out",
    })
  })

  it("returns a value and passes a rejection through inside the budget", async () => {
    const atMs = performance.now() + 1_000
    const failure = new Error("upstream")

    await expect(beforeDeadline(Promise.resolve("ok"), atMs)).resolves.toBe(
      "ok",
    )
    await expect(beforeDeadline(Promise.reject(failure), atMs)).rejects.toBe(
      failure,
    )
  })

  it("does not leak an unhandled rejection from an abandoned promise", async () => {
    const atMs = performance.now() + 10
    const abandoned = new Promise((_resolve, reject) =>
      setTimeout(reject, 30, new Error("late failure")),
    )

    await expect(settleBeforeDeadline(abandoned, atMs)).resolves.toMatchObject({
      status: "timed_out",
    })
    // Vitest fails the run on an unhandled rejection; wait past it.
    await new Promise((resolve) => setTimeout(resolve, 40))
  })

  it("refuses a stage boundary once the budget is gone", () => {
    expect(() => assertBeforeDeadline(performance.now() - 1)).toThrow(
      WatchSearchTimeoutError,
    )
    expect(() => assertBeforeDeadline(performance.now() + 1_000)).not.toThrow()
  })
})
