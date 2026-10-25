import { shouldArmHideTimer, type AutoHideGate } from "../autoHide"

// Tests the pure predicate deciding whether the inactivity timer may arm: the
// core of AE1 (auto-hide only while playing) plus the buffering/ended/screen-reader
// gates. The hook's Animated/AppState/listener orchestration is sim-verified (R19).

describe("shouldArmHideTimer", () => {
  const playing: AutoHideGate = {
    isPaused: false,
    status: "readyToPlay",
    screenReaderEnabled: false,
  }

  it("arms during steady playback (AE1: playing → auto-hides)", () => {
    expect(shouldArmHideTimer(playing)).toBe(true)
  })

  it("never arms while paused or ended (AE1: paused → stays visible)", () => {
    // End-of-video reports isPlaying=false → isPaused=true; chrome stays up.
    expect(shouldArmHideTimer({ ...playing, isPaused: true })).toBe(false)
  })

  it("never arms while buffering (status loading)", () => {
    expect(shouldArmHideTimer({ ...playing, status: "loading" })).toBe(false)
  })

  it("never arms in the error state", () => {
    expect(shouldArmHideTimer({ ...playing, status: "error" })).toBe(false)
  })

  it("never arms before the source is ready (status idle)", () => {
    expect(shouldArmHideTimer({ ...playing, status: "idle" })).toBe(false)
  })

  it("never arms while a screen reader is active (chrome stays reachable)", () => {
    expect(shouldArmHideTimer({ ...playing, screenReaderEnabled: true })).toBe(
      false,
    )
  })
})
