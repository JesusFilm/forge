import { describe, expect, it } from "vitest"
import { createJobDeadline, JobDeadlineExceededError } from "./deadline.js"

function fakeClock(startMs = 0) {
  let nowMs = startMs
  return {
    now: () => nowMs,
    advance(ms: number) {
      nowMs += ms
    },
  }
}

describe("createJobDeadline", () => {
  it("reports the remaining budget as time advances", () => {
    const clock = fakeClock()
    const deadline = createJobDeadline(1_000, clock.now)

    expect(deadline.remainingMs()).toBe(1_000)
    clock.advance(400)
    expect(deadline.remainingMs()).toBe(600)
    clock.advance(700)
    expect(deadline.remainingMs()).toBe(-100)
  })

  it("reports elapsed time since enqueue", () => {
    const clock = fakeClock(5_000)
    const deadline = createJobDeadline(1_000, clock.now)

    expect(deadline.elapsedMs()).toBe(0)
    clock.advance(750)
    expect(deadline.elapsedMs()).toBe(750)
  })

  it("caps an invocation timeout at the remaining budget", () => {
    const clock = fakeClock()
    const deadline = createJobDeadline(1_000, clock.now)

    // Plenty of budget: the per-invocation cap wins.
    expect(deadline.capTimeoutMs(300)).toBe(300)

    // Budget below the cap: the remaining budget wins.
    clock.advance(900)
    expect(deadline.capTimeoutMs(300)).toBe(100)
  })

  it("throws a typed JobDeadlineExceededError once the deadline passes", () => {
    const clock = fakeClock()
    const deadline = createJobDeadline(1_000, clock.now)

    clock.advance(1_500)
    expect(() => deadline.capTimeoutMs(300)).toThrow(JobDeadlineExceededError)
    expect(() => deadline.capTimeoutMs(300)).toThrow(
      /job deadline exceeded after 2s/,
    )
  })

  it("classifies as retryable (queue pressure, not a property of the job)", () => {
    const clock = fakeClock()
    const deadline = createJobDeadline(10, clock.now)
    clock.advance(20)

    try {
      deadline.capTimeoutMs(300)
      expect.unreachable("capTimeoutMs should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(JobDeadlineExceededError)
      expect((error as JobDeadlineExceededError).reason).toBe(
        "deadline_exceeded",
      )
      expect((error as JobDeadlineExceededError).retryable).toBe(true)
    }
  })
})
