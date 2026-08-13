import { shouldPauseOnAppStateChange } from "../pipPolicy"

describe("shouldPauseOnAppStateChange (R13, KTD12)", () => {
  it("pauses on background when picture-in-picture is not carrying playback", () => {
    expect(shouldPauseOnAppStateChange("background", false)).toBe(true)
  })

  it("does NOT pause on background while picture-in-picture is active", () => {
    // The whole point of R13. Android reports picture-in-picture ENTRY as
    // 'background', not 'inactive' — so the pre-existing unconditional
    // pause-on-background would stop the video the system just handed to the
    // picture-in-picture window.
    expect(shouldPauseOnAppStateChange("background", true)).toBe(false)
  })

  it("does NOT pause on inactive, with or without picture-in-picture", () => {
    // 'inactive' is the transient iOS state for the app switcher, control
    // centre and the incoming-call banner. Pausing there stops playback for a
    // notification shade the viewer swipes straight back out of.
    expect(shouldPauseOnAppStateChange("inactive", false)).toBe(false)
    expect(shouldPauseOnAppStateChange("inactive", true)).toBe(false)
  })

  it("never pauses on active", () => {
    expect(shouldPauseOnAppStateChange("active", false)).toBe(false)
    expect(shouldPauseOnAppStateChange("active", true)).toBe(false)
  })

  it("treats an unknown state as not-a-pause", () => {
    // RN adds states (`extension`, and Android has reported others). Pausing
    // on an unrecognised string is the destructive default.
    expect(shouldPauseOnAppStateChange("extension", false)).toBe(false)
    expect(shouldPauseOnAppStateChange("unknown", false)).toBe(false)
  })
})
