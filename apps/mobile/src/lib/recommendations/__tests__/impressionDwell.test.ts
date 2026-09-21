/**
 * feat-517 KTD4: the impression dwell tracker. Four signals decide, a fake
 * clock drives every timing, and no React, list or native module takes part.
 */

jest.mock("../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { datadogLog } from "../../datadog"
import {
  IMPRESSION_DWELL_MS,
  createImpressionDwellTracker,
  guardViewabilityCallback,
  isForegroundAppState,
  type DwellScheduler,
  type ImpressionDwellTracker,
} from "../impressionDwell"

const warn = datadogLog.warn as unknown as jest.Mock

// ── A fake clock ────────────────────────────────────────────────────────────

type Pending = { at: number; run: () => void }

/**
 * `cancels: false` makes the returned cancel inert, so a test can drive a
 * timer the tracker believes it cancelled.
 */
function fakeClock(options: { cancels?: boolean } = {}) {
  const cancels = options.cancels ?? true
  let now = 0
  let nextId = 0
  const pending = new Map<number, Pending>()

  const schedule: DwellScheduler = (run, delayMs) => {
    const id = (nextId += 1)
    pending.set(id, { at: now + delayMs, run })
    return () => {
      if (cancels) pending.delete(id)
    }
  }

  function due(limit: number): [number, Pending] | null {
    let best: [number, Pending] | null = null
    for (const entry of pending) {
      if (entry[1].at > limit) continue
      if (best == null || entry[1].at < best[1].at) best = entry
    }
    return best
  }

  return {
    schedule,
    now: () => now,
    pendingCount: () => pending.size,
    advance(ms: number) {
      const limit = now + ms
      for (;;) {
        const next = due(limit)
        if (next == null) break
        pending.delete(next[0])
        now = next[1].at
        next[1].run()
      }
      now = limit
    },
  }
}

// ── Harness ─────────────────────────────────────────────────────────────────

type Harness = {
  tracker: ImpressionDwellTracker
  clock: ReturnType<typeof fakeClock>
  recorded: string[]
}

/** A tracker whose four signals already hold, with the given cards visible. */
function watching(
  itemIds: string[] = ["item-0"],
  options: { cancels?: boolean } = {},
): Harness {
  const clock = fakeClock(options)
  const recorded: string[] = []
  const tracker = createImpressionDwellTracker({
    onImpression: (itemId) => recorded.push(itemId),
    schedule: clock.schedule,
  })
  tracker.setRequestId("req-1")
  tracker.setAppActive(true)
  tracker.setFocused(true)
  tracker.setRowVisible(true)
  tracker.setVisibleCards(itemIds)
  return { tracker, clock, recorded }
}

afterEach(() => {
  jest.clearAllMocks()
})

// ── The dwell ───────────────────────────────────────────────────────────────

describe("the one-second dwell (AE5, R12)", () => {
  it("records nothing for a card held 0.6 s", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(600)
    tracker.setVisibleCards([])
    clock.advance(5_000)
    expect(recorded).toEqual([])
  })

  it("records exactly one impression for a card held 1.2 s", () => {
    const { clock, recorded } = watching()
    clock.advance(1_200)
    expect(recorded).toEqual(["item-0"])
  })

  it("records at the threshold and never twice for the same card", () => {
    const { clock, recorded } = watching()
    clock.advance(IMPRESSION_DWELL_MS - 1)
    expect(recorded).toEqual([])
    clock.advance(1)
    expect(recorded).toEqual(["item-0"])
    clock.advance(10_000)
    expect(recorded).toEqual(["item-0"])
  })

  it("arms nothing until every signal holds", () => {
    const clock = fakeClock()
    const recorded: string[] = []
    const tracker = createImpressionDwellTracker({
      onImpression: (itemId) => recorded.push(itemId),
      schedule: clock.schedule,
    })
    tracker.setRequestId("req-1")
    tracker.setVisibleCards(["item-0"])
    tracker.setRowVisible(true)
    tracker.setFocused(true)
    clock.advance(5_000)
    // The app signal is the one still missing.
    expect(recorded).toEqual([])

    tracker.setAppActive(true)
    clock.advance(IMPRESSION_DWELL_MS)
    expect(recorded).toEqual(["item-0"])
  })
})

// ── A dropped signal ────────────────────────────────────────────────────────

describe("a signal that drops", () => {
  it("cancels on the row leaving and restarts when it returns", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(700)
    tracker.setRowVisible(false)
    clock.advance(200)
    expect(recorded).toEqual([])

    tracker.setRowVisible(true)
    clock.advance(999)
    expect(recorded).toEqual([])
    clock.advance(1)
    expect(clock.now()).toBe(1_900)
    expect(recorded).toEqual(["item-0"])
  })

  it("cancels on the app leaving the foreground and restarts on return", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(500)
    tracker.setAppActive(false)
    clock.advance(300)
    tracker.setAppActive(true)
    clock.advance(999)
    expect(recorded).toEqual([])
    clock.advance(1)
    expect(clock.now()).toBe(1_800)
    expect(recorded).toEqual(["item-0"])
  })

  it("cancels on a blurred Home and restarts on refocus", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(500)
    tracker.setFocused(false)
    clock.advance(400)
    expect(recorded).toEqual([])

    tracker.setFocused(true)
    clock.advance(999)
    expect(recorded).toEqual([])
    clock.advance(1)
    expect(clock.now()).toBe(1_900)
    expect(recorded).toEqual(["item-0"])
  })

  it("cancels on the card leaving its row", () => {
    const { tracker, clock, recorded } = watching(["item-0", "item-1"])
    clock.advance(990)
    tracker.setVisibleCards(["item-1"])
    clock.advance(5)
    tracker.setVisibleCards(["item-0", "item-1"])
    clock.advance(999)
    // The card left at 0.99 s, so its dwell restarts from its return.
    expect(recorded).toEqual(["item-1"])
    clock.advance(1)
    expect(clock.now()).toBe(1_995)
    expect(recorded).toEqual(["item-1", "item-0"])
  })
})

// ── Several cards ───────────────────────────────────────────────────────────

describe("several cards", () => {
  it("records each visible card once", () => {
    const { tracker, clock, recorded } = watching(["item-0", "item-1"])
    clock.advance(1_000)
    expect([...recorded].sort()).toEqual(["item-0", "item-1"])

    // Out of the row and back in: already recorded, so nothing more.
    tracker.setVisibleCards([])
    tracker.setVisibleCards(["item-0", "item-1"])
    clock.advance(5_000)
    expect([...recorded].sort()).toEqual(["item-0", "item-1"])
  })

  it("holds the dwell when the same cards are reported again", () => {
    // The row re-reports its visible cards on every slate render, so an
    // unchanged report must not restart the second the viewer already spent.
    const { tracker, clock, recorded } = watching(["item-0", "item-1"])
    clock.advance(900)
    tracker.setVisibleCards(["item-1", "item-0"])
    clock.advance(100)
    expect([...recorded].sort()).toEqual(["item-0", "item-1"])
  })
})

// ── A new slate ─────────────────────────────────────────────────────────────

describe("a new request id", () => {
  it("lets the same item id record again and re-arms a held card", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(1_000)
    expect(recorded).toEqual(["item-0"])

    tracker.setRequestId("req-2")
    clock.advance(999)
    expect(recorded).toEqual(["item-0"])
    clock.advance(1)
    expect(recorded).toEqual(["item-0", "item-0"])
  })

  it("restarts the dwell of a card armed under the old slate", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(900)
    tracker.setRequestId("req-2")
    clock.advance(900)
    expect(recorded).toEqual([])
    clock.advance(100)
    expect(recorded).toEqual(["item-0"])
  })

  it("drops a timer that fires for a replaced request id", () => {
    // SYNTHETIC substrate: `setRequestId` cancels every armed timer, so with a
    // real `clearTimeout` this branch is unreachable. The clock below keeps a
    // cancelled timer alive to prove the fire-time check, which is what keeps
    // an impression off the wrong slate if a cancel is ever lost.
    const { tracker, clock, recorded } = watching(["item-0"], {
      cancels: false,
    })
    clock.advance(900)
    tracker.setRequestId("req-2")
    tracker.setVisibleCards([])
    clock.advance(1_000)
    expect(recorded).toEqual([])
  })

  it("stops every dwell when the slate goes away", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(900)
    tracker.setRequestId(null)
    clock.advance(5_000)
    expect(recorded).toEqual([])
    expect(clock.pendingCount()).toBe(0)
  })
})

// ── A detached row ──────────────────────────────────────────────────────────

describe("a detached row", () => {
  it("clears every card signal and starts the next report from nothing", () => {
    const { tracker, clock, recorded } = watching(["item-0", "item-1"])
    clock.advance(900)
    tracker.detachRow()
    clock.advance(5_000)
    expect(recorded).toEqual([])
    expect(clock.pendingCount()).toBe(0)

    tracker.setVisibleCards(["item-0"])
    clock.advance(1_000)
    expect(recorded).toEqual(["item-0"])
  })
})

// ── The mount cycle ─────────────────────────────────────────────────────────

describe("suspend and resume", () => {
  it("records nothing and leaves no timer behind on suspend", () => {
    const { tracker, clock, recorded } = watching()
    clock.advance(900)
    tracker.suspend()
    clock.advance(5_000)
    expect(recorded).toEqual([])
    expect(clock.pendingCount()).toBe(0)
  })

  it("re-arms from the latest signals and keeps what it already recorded", () => {
    const { tracker, clock, recorded } = watching(["item-0", "item-1"])
    clock.advance(1_000)
    expect([...recorded].sort()).toEqual(["item-0", "item-1"])

    tracker.suspend()
    tracker.resume()
    clock.advance(5_000)
    // Both cards are still visible; both are already recorded for this slate.
    expect([...recorded].sort()).toEqual(["item-0", "item-1"])

    tracker.setRequestId("req-2")
    clock.advance(1_000)
    expect(recorded.length).toBe(4)
  })

  it("arms nothing while suspended", () => {
    const { tracker, clock, recorded } = watching()
    tracker.suspend()
    tracker.setVisibleCards(["item-0", "item-1"])
    clock.advance(5_000)
    expect(recorded).toEqual([])

    tracker.resume()
    clock.advance(1_000)
    expect([...recorded].sort()).toEqual(["item-0", "item-1"])
  })
})

// ── The app-state reading ───────────────────────────────────────────────────

describe("the foreground reading of an app state", () => {
  it("stops the dwell on background and inactive only", () => {
    expect(isForegroundAppState("background")).toBe(false)
    expect(isForegroundAppState("inactive")).toBe(false)
    expect(isForegroundAppState("active")).toBe(true)
  })

  it("reads an unanswered app state as the foreground", () => {
    // `AppState.currentState` is null until the native module answers; a
    // closed reading there would drop every impression of the launch.
    expect(isForegroundAppState(null)).toBe(true)
    expect(isForegroundAppState(undefined)).toBe(true)
    expect(isForegroundAppState("unknown")).toBe(true)
  })
})

// ── The never-throw wrapper ─────────────────────────────────────────────────

describe("the viewability guard", () => {
  it("passes the report through", () => {
    const report = jest.fn()
    guardViewabilityCallback("home_feed", report)({ viewableItems: [] })
    expect(report).toHaveBeenCalledWith({ viewableItems: [] })
    expect(warn).not.toHaveBeenCalled()
  })

  it("swallows a throw and logs it once", () => {
    const guarded = guardViewabilityCallback("home_feed", () => {
      throw new Error("boom")
    })
    expect(() => guarded(null)).not.toThrow()
    expect(() => guarded(null)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith("recommendation.viewability_failed", {
      rec_surface: "home_feed",
    })
  })

  it("logs nothing the caller handed it", () => {
    // The thrown value can carry list internals; only the surface is logged.
    const guarded = guardViewabilityCallback("recommendations_row", () => {
      throw new Error("viewer-token-abc")
    })
    guarded(null)
    expect(JSON.stringify(warn.mock.calls)).not.toContain("viewer-token-abc")
  })
})
