import {
  appStateBranchDecision,
  pipHoldTransitionDecision,
  type AppStateLike,
} from "../pipPolicy"

describe("pipHoldTransitionDecision", () => {
  const away = {
    armsPip: true,
    foreground: false,
    castActive: false,
    wasPlaying: true,
  }

  it("arms the guard and undoes the background pause when the window starts", () => {
    expect(
      pipHoldTransitionDecision({ ...away, transition: "started" }),
    ).toEqual({ armLeftUnderPip: true, resume: true, pause: false })
  })

  // The guard must arm even when nothing is resumed, or the return from a
  // closed window falls back to the stale was-playing snapshot.
  it.each([
    ["a session owns transport", { castActive: true }],
    ["the video was not playing", { wasPlaying: false }],
  ])("arms the guard but starts nothing when %s", (_name, override) => {
    expect(
      pipHoldTransitionDecision({
        ...away,
        ...override,
        transition: "started",
      }),
    ).toEqual({ armLeftUnderPip: true, resume: false, pause: false })
  })

  // Only the root host's view enters the OS window, so a second adapter must
  // not treat the shared latch as its own.
  it("does nothing for a view that does not arm the window", () => {
    expect(
      pipHoldTransitionDecision({
        ...away,
        armsPip: false,
        transition: "started",
      }),
    ).toEqual({ armLeftUnderPip: false, resume: false, pause: false })
  })

  it("runs the suspended pause when the window is released while away", () => {
    expect(
      pipHoldTransitionDecision({ ...away, transition: "released" }),
    ).toEqual({ armLeftUnderPip: false, resume: false, pause: true })
  })

  it.each([
    ["the app is in the foreground", { foreground: true }],
    ["a session owns transport", { castActive: true }],
  ])("does not pause on release when %s", (_name, override) => {
    expect(
      pipHoldTransitionDecision({
        ...away,
        ...override,
        transition: "released",
      }).pause,
    ).toBe(false)
  })

  it("does nothing when the latch did not change", () => {
    expect(pipHoldTransitionDecision({ ...away, transition: "none" })).toEqual({
      armLeftUnderPip: false,
      resume: false,
      pause: false,
    })
  })
})

describe("appStateBranchDecision", () => {
  it("does not pause on background while picture-in-picture is active (R13)", () => {
    expect(appStateBranchDecision("background", true)).toEqual({
      pause: false,
      recordWasPlaying: false,
      flushProgress: true,
    })
  })

  it("pauses on background when picture-in-picture is not active", () => {
    expect(appStateBranchDecision("background", false)).toEqual({
      pause: true,
      recordWasPlaying: true,
      flushProgress: true,
    })
  })

  it.each([true, false])(
    "never pauses on inactive (picture-in-picture active: %s)",
    (pipActive) => {
      expect(appStateBranchDecision("inactive", pipActive).pause).toBe(false)
    },
  )

  it("records no resume instruction under picture-in-picture", () => {
    // Playback never stopped, so a was-playing flag would replay a pause the
    // viewer made inside the operating system's window.
    expect(appStateBranchDecision("background", true).recordWasPlaying).toBe(
      false,
    )
  })

  it("still flushes progress under picture-in-picture", () => {
    expect(appStateBranchDecision("background", true).flushProgress).toBe(true)
  })

  it.each([true, false])(
    "treats active as no decision (picture-in-picture active: %s)",
    (pipActive) => {
      expect(appStateBranchDecision("active", pipActive)).toEqual({
        pause: false,
        recordWasPlaying: false,
        flushProgress: false,
      })
    },
  )

  it.each<AppStateLike>(["unknown", "extension"])(
    "keeps today's pause for the iOS-only %s state",
    (state) => {
      expect(appStateBranchDecision(state, false).pause).toBe(true)
      expect(appStateBranchDecision(state, true).pause).toBe(false)
    },
  )

  it("distinguishes background from inactive, which is the whole point", () => {
    expect(appStateBranchDecision("background", false).pause).toBe(true)
    expect(appStateBranchDecision("inactive", false).pause).toBe(false)
  })
})
