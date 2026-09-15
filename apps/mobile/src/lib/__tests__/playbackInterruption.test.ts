/**
 * The transport borrows the app's single player, which the native side can
 * release at any time. Every call into it is guarded, and these are the cases
 * that prove the guards do what they claim rather than swallowing the state.
 */

import {
  beginPlaybackInterruption,
  resetPlaybackTransportForTests,
  setPlaybackTransport,
} from "../playbackInterruption"

beforeEach(() => {
  resetPlaybackTransportForTests()
})

describe("beginPlaybackInterruption", () => {
  it("pauses a playing video and resumes it once", () => {
    const calls: string[] = []
    setPlaybackTransport({
      isPlaying: () => true,
      pause: () => calls.push("pause"),
      play: () => calls.push("play"),
    })

    const interruption = beginPlaybackInterruption()
    expect(interruption.wasPlaying).toBe(true)
    expect(calls).toEqual(["pause"])

    interruption.resume()
    interruption.resume()
    expect(calls).toEqual(["pause", "play"])
  })

  it("neither pauses nor resumes a video that was not playing", () => {
    const calls: string[] = []
    setPlaybackTransport({
      isPlaying: () => false,
      pause: () => calls.push("pause"),
      play: () => calls.push("play"),
    })

    const interruption = beginPlaybackInterruption()
    interruption.resume()

    expect(interruption.wasPlaying).toBe(false)
    expect(calls).toEqual([])
  })

  it("treats an unreadable player as not playing", () => {
    const calls: string[] = []
    setPlaybackTransport({
      isPlaying: () => {
        throw new Error("released")
      },
      pause: () => calls.push("pause"),
      play: () => calls.push("play"),
    })

    const interruption = beginPlaybackInterruption()
    interruption.resume()

    expect(interruption.wasPlaying).toBe(false)
    expect(calls).toEqual([])
  })

  // A pause that could not land means nothing is playing, so the later resume
  // must not start a video the viewer never had running.
  it("rolls back wasPlaying when the pause itself fails", () => {
    const calls: string[] = []
    setPlaybackTransport({
      isPlaying: () => true,
      pause: () => {
        throw new Error("released")
      },
      play: () => calls.push("play"),
    })

    const interruption = beginPlaybackInterruption()
    interruption.resume()

    expect(interruption.wasPlaying).toBe(false)
    expect(calls).toEqual([])
  })

  it("does not throw when the player is released before the resume", () => {
    setPlaybackTransport({
      isPlaying: () => true,
      pause: () => undefined,
      play: () => {
        throw new Error("released")
      },
    })

    const interruption = beginPlaybackInterruption()
    expect(() => interruption.resume()).not.toThrow()
  })

  it("is inert when no host has registered a player", () => {
    const interruption = beginPlaybackInterruption()

    expect(interruption.wasPlaying).toBe(false)
    expect(() => interruption.resume()).not.toThrow()
  })
})
