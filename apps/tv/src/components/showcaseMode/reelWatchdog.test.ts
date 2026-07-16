import {
  REEL_LOAD_DEADLINE_MS,
  REEL_STALL_DEADLINE_MS,
  classifyReelWatchdog,
} from "./reelWatchdog"

// Steady state: the reel is playing and the playhead is moving. Every case perturbs
// one axis away from it.
const playing = {
  playIntended: true,
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

  it("holds the load budget open past the stall deadline, which does not apply yet", () => {
    // A slow HLS start is the common case on office wifi, not a fault. Charging it the
    // tighter freeze deadline would skip an excerpt that was seconds from playing.
    expect(
      classifyReelWatchdog({
        ...playing,
        confirmed: false,
        msSincePlayRequested: REEL_STALL_DEADLINE_MS + 1,
        msSincePlayheadAdvance: null,
      }),
    ).toBe("ok")
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

  // A resume re-arms the clock without a token bump. If confirmation outlived the
  // heartbeat it was seeded with, the excerpt would read as confirmed-but-silent and
  // fall between both deadlines — armed, ticking, and structurally unable to fire.
  it("charges a re-armed excerpt the load budget, because a resume is a fresh load", () => {
    for (const elapsed of [
      0,
      REEL_STALL_DEADLINE_MS,
      REEL_LOAD_DEADLINE_MS - 1,
    ]) {
      expect(
        classifyReelWatchdog({
          ...playing,
          confirmed: false,
          msSincePlayheadAdvance: null,
          msSincePlayRequested: elapsed,
        }),
      ).toBe("ok")
    }
    expect(
      classifyReelWatchdog({
        ...playing,
        confirmed: false,
        msSincePlayheadAdvance: null,
        msSincePlayRequested: REEL_LOAD_DEADLINE_MS,
      }),
    ).toBe("load-timeout")
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
          playIntended: false,
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
        playIntended: false,
        msSincePlayheadAdvance: REEL_STALL_DEADLINE_MS * 5,
      }),
    ).toBe("ok")
  })
})

describe("classifyReelWatchdog — deadline shape", () => {
  it("gives a freeze less rope than a load, because the viewer sees a stuck frame", () => {
    expect(REEL_STALL_DEADLINE_MS).toBeLessThan(REEL_LOAD_DEADLINE_MS)
  })
})
