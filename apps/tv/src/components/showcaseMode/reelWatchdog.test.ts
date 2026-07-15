import {
  REEL_LOAD_DEADLINE_MS,
  REEL_STALL_DEADLINE_MS,
  classifyReelWatchdog,
} from "./reelWatchdog"

// Steady state: the reel is playing and the playhead is moving. Every case perturbs
// one axis away from it.
const playing = {
  shouldPlay: true,
  confirmed: true,
  msSincePlayRequested: 30_000,
  msSincePlayheadAdvance: 500,
}

describe("classifyReelWatchdog — a source that never starts", () => {
  it("waits while the player is still loading inside the deadline", () => {
    expect(
      classifyReelWatchdog({
        ...playing,
        confirmed: false,
        msSincePlayRequested: REEL_LOAD_DEADLINE_MS - 1,
        msSincePlayheadAdvance: null,
      }),
    ).toBe("ok")
  })

  it("fails the excerpt once the deadline passes with no first frame", () => {
    expect(
      classifyReelWatchdog({
        ...playing,
        confirmed: false,
        msSincePlayRequested: REEL_LOAD_DEADLINE_MS,
        msSincePlayheadAdvance: null,
      }),
    ).toBe("load-timeout")
  })
})

describe("classifyReelWatchdog — a source that freezes mid-play", () => {
  it("tolerates the gap between two heartbeats", () => {
    expect(
      classifyReelWatchdog({ ...playing, msSincePlayheadAdvance: 1_500 }),
    ).toBe("ok")
  })

  it("fails the excerpt once the playhead goes quiet past the deadline", () => {
    expect(
      classifyReelWatchdog({
        ...playing,
        msSincePlayheadAdvance: REEL_STALL_DEADLINE_MS,
      }),
    ).toBe("stalled")
  })

  it("calls it stalled, not a load timeout, when the player claimed to play but never moved", () => {
    // playingChange fired, so the load deadline is spent; the playhead is the truth.
    expect(
      classifyReelWatchdog({
        ...playing,
        msSincePlayheadAdvance: null,
        msSincePlayRequested: REEL_STALL_DEADLINE_MS,
      }),
    ).toBe("stalled")
  })

  it("does not fail a confirmed excerpt on the load deadline it already beat", () => {
    expect(
      classifyReelWatchdog({
        ...playing,
        msSincePlayRequested: REEL_LOAD_DEADLINE_MS * 10,
      }),
    ).toBe("ok")
  })
})

// The reel PAUSES the player under chapter cards, interstitials, stills and
// background. Without this gate the watchdog fires on every chapter — the exact
// false-positive that would make it worse than no watchdog at all.
describe("classifyReelWatchdog — the reel's own deliberate pauses", () => {
  it("never fires while the reel is not asking for playback", () => {
    for (const elapsed of [
      0,
      REEL_STALL_DEADLINE_MS,
      REEL_LOAD_DEADLINE_MS * 10,
    ]) {
      expect(
        classifyReelWatchdog({
          shouldPlay: false,
          confirmed: false,
          msSincePlayRequested: elapsed,
          msSincePlayheadAdvance: elapsed,
        }),
      ).toBe("ok")
    }
  })

  it("never fires on a paused excerpt whose playhead is frozen by design", () => {
    expect(
      classifyReelWatchdog({
        ...playing,
        shouldPlay: false,
        msSincePlayheadAdvance: REEL_STALL_DEADLINE_MS * 5,
      }),
    ).toBe("ok")
  })
})

describe("classifyReelWatchdog — deadline shape", () => {
  it("gives a freeze less rope than a load, because the viewer sees a stuck frame", () => {
    expect(REEL_STALL_DEADLINE_MS).toBeLessThan(REEL_LOAD_DEADLINE_MS)
  })

  it("leaves the load deadline clear of the chapter card it waits behind", () => {
    // The card holds the player paused; the load clock only starts when it lifts.
    expect(REEL_LOAD_DEADLINE_MS).toBeGreaterThan(REEL_STALL_DEADLINE_MS)
  })
})
