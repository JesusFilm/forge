import { appStateBranchDecision, type AppStateLike } from "../pipPolicy"

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
